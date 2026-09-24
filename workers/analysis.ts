import { Worker } from 'bullmq';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { redis } from '../modules/jobs/queue';
import { analyzeRepository } from '../modules/analysis';
import { buildGraph } from '../modules/analysis/graph/build';
import { downloadRepository } from '../modules/github/repository';
import { accessibleRepositories } from '../modules/github/client';
import { inferEndpoint, candidate, deduplicate } from '../modules/ai/gemini';
import { HiveError } from '../lib/errors';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const worker = new Worker(
  'hive-analysis',
  async (job) => {
    const run = await db.analysisRun.findUniqueOrThrow({
      where: { id: job.data.runId },
      include: { application: true },
    });
    const base = path.resolve('.hive/repositories');
    await mkdir(base, { recursive: true, mode: 0o700 });
    const workspace = await mkdtemp(path.join(base, 'analysis-'));
    const update = async (stage: string, progress: number, extra: Record<string, unknown> = {}) =>
      db.analysisRun.update({
        where: { id: run.id },
        data: { status: 'RUNNING', stage, progress, ...extra },
      });
    try {
      await update('Checking repository access', 3);
      const repos = await accessibleRepositories(run.application.userId);
      if (
        !repos.some(
          (r) =>
            r.id === run.application.repositoryId &&
            r.installationId === run.application.installationId,
        )
      )
        throw new HiveError('GITHUB_ACCESS_DENIED');
      await update('Downloading source at a pinned commit', 8);
      const sha = await downloadRepository(run.application, workspace);
      await update('Indexing TypeScript, routes, schemas and services', 25, { commitSha: sha });
      const index = await analyzeRepository(workspace);
      if (index.framework !== 'Next.js') throw new HiveError('UNSUPPORTED_FRAMEWORK');
      const metrics = {
        files: index.files,
        routes: index.endpoints.length,
        services: index.services.length,
        schemas: index.schemas.length,
        models: index.models.length,
        permissions: new Set(index.endpoints.flatMap((e) => e.permissions)).size,
      };
      await update('Building application evidence graph', 45, {
        index: json(index),
        metrics: json(metrics),
      });
      const graph = buildGraph(index);
      await db.$transaction([
        db.graphEdge.deleteMany({ where: { runId: run.id } }),
        db.graphNode.deleteMany({ where: { runId: run.id } }),
        db.graphNode.createMany({
          data: graph.nodes.map((n) => ({
            ...n,
            id: `${run.id}:${n.id}`,
            runId: run.id,
            data: json(n.data),
          })),
        }),
        db.graphEdge.createMany({
          data: graph.edges.map((e) => ({
            ...e,
            runId: run.id,
            source: `${run.id}:${e.source}`,
            target: `${run.id}:${e.target}`,
          })),
        }),
      ]);
      const candidates = [];
      for (const [i, endpoint] of index.endpoints.entries()) {
        if (['OPTIONS', 'HEAD'].includes(endpoint.method)) continue;
        await update(
          `Semantic analysis: ${i + 1} of ${index.endpoints.length} endpoints`,
          50 + Math.floor((40 * i) / Math.max(index.endpoints.length, 1)),
        );
        candidates.push(candidate(await inferEndpoint(endpoint, index), endpoint, index));
      }
      const unique = deduplicate(candidates);
      if (new Set(unique.map((c) => c.name)).size !== unique.length)
        throw new HiveError('CAPABILITY_NAME_COLLISION');
      await update('Saving candidates for developer review', 95);
      await db.$transaction(async (tx) => {
        // Each new analysis invalidates publication. No inferred change is silently approved.
        await tx.capability.updateMany({
          where: { applicationId: run.applicationId },
          data: { enabled: false, status: 'STALE', verifiedAt: null },
        });
        for (const capability of unique) {
          const { idempotent, ...fields } = capability;
          const data = {
            ...fields,
            inputSchema: json(fields.inputSchema),
            implementation: json({ ...fields.implementation, idempotent }),
            evidence: json(fields.evidence),
            permissions: json(fields.permissions),
            preconditions: json(fields.preconditions),
            sideEffects: json(fields.sideEffects),
            affectedModels: json(fields.affectedModels),
            analysisRunId: run.id,
            applicationId: run.applicationId,
            verifiedAt: null,
          };
          const saved = await tx.capability.upsert({
            where: {
              applicationId_name: { applicationId: run.applicationId, name: capability.name },
            },
            create: data,
            update: data,
          });
          await tx.graphNode.create({
            data: {
              id: `${run.id}:capability:${saved.id}`,
              runId: run.id,
              kind: 'Capability',
              label: saved.displayName,
              data: { capabilityId: saved.id },
            },
          });
          await tx.graphEdge.create({
            data: {
              runId: run.id,
              source: `${run.id}:capability:${saved.id}`,
              target: `${run.id}:${capability.implementation.endpointId}`,
              kind: 'CAPABILITY_IMPLEMENTED_BY',
            },
          });
        }
        await tx.application.update({
          where: { id: run.applicationId },
          data: {
            framework: index.framework,
            language: index.language,
            analyzedCommitSha: sha,
            currentCommitSha: sha,
            sourceChanged: false,
            published: false,
          },
        });
        await tx.analysisRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETED',
            stage: 'Analysis complete — developer review required',
            progress: 100,
            completedAt: new Date(),
            metrics: json({ ...metrics, capabilities: unique.length }),
          },
        });
      });
    } catch (error) {
      const code =
        error instanceof HiveError
          ? error.code
          : error instanceof Error && error.message.startsWith('CONFIGURATION_REQUIRED:')
            ? error.message
            : 'ANALYSIS_FAILED';
      await db.analysisRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          stage: 'Analysis stopped',
          errorCode: code,
          completedAt: new Date(),
        },
      });
      throw new Error(code);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
  { connection: redis(), concurrency: 1, lockDuration: 300000 },
);
worker.on('completed', (job) => console.log(`Analysis job ${job.id} completed`));
worker.on('failed', (job, error) =>
  console.error(
    `Analysis job ${job?.id}: ${error.message.startsWith('CONFIGURATION_REQUIRED') ? error.message : 'FAILED'}`,
  ),
);
worker.on('error', () => console.error('Analysis worker connection error'));
console.log('Hive analysis worker ready');
async function stop() {
  await worker.close();
  await redis().quit();
  await db.$disconnect();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
