-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "installationId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "repositoryOwner" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "currentCommitSha" TEXT,
    "analyzedCommitSha" TEXT,
    "sourceChanged" BOOLEAN NOT NULL DEFAULT false,
    "framework" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'Waiting for worker',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "index" JSONB,
    "commitSha" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "policy" TEXT NOT NULL DEFAULT 'confirmation_required',
    "operationType" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "implementation" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "preconditions" JSONB NOT NULL,
    "sideEffects" JSONB NOT NULL,
    "affectedModels" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEnvironment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Local',
    "baseUrl" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedClientSecret" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'CONFIGURED',

    CONSTRAINT "ApplicationEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationCredential" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Confirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "capabilityName" TEXT NOT NULL,
    "environmentId" TEXT,
    "client" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "inputSummary" JSONB NOT NULL,
    "resultSummary" JSONB NOT NULL,
    "errorCode" TEXT,
    "policy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubConnection_userId_key" ON "GitHubConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_slug_key" ON "Application"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_repositoryId_key" ON "Application"("userId", "repositoryId");

-- CreateIndex
CREATE INDEX "AnalysisRun_applicationId_createdAt_idx" ON "AnalysisRun"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "GraphNode_runId_kind_idx" ON "GraphNode"("runId", "kind");

-- CreateIndex
CREATE INDEX "GraphEdge_runId_idx" ON "GraphEdge"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Capability_applicationId_name_key" ON "Capability"("applicationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEnvironment_applicationId_key" ON "ApplicationEnvironment"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationCredential_environmentId_userId_key" ON "ApplicationCredential"("environmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_accessHash_key" ON "AgentToken"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_refreshHash_key" ON "AgentToken"("refreshHash");

-- CreateIndex
CREATE INDEX "ExecutionLog_applicationId_createdAt_idx" ON "ExecutionLog"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capability" ADD CONSTRAINT "Capability_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capability" ADD CONSTRAINT "Capability_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEnvironment" ADD CONSTRAINT "ApplicationEnvironment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCredential" ADD CONSTRAINT "ApplicationCredential_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "ApplicationEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

