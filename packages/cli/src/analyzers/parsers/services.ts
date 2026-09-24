import { Node, SyntaxKind, type Project } from 'ts-morph';
import type { ServiceInfo } from '../types.js';
export function callsIn(node: Node): string[] {
  return [
    ...new Set(
      node
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .map((call) => call.getExpression().getText()),
    ),
  ];
}
export function permissionsIn(node: Node): string[] {
  return [
    ...new Set(
      node
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((call) =>
          /\b(requirePermission|authorize|can|checkPermission|requireRole|requireAuth|auth|getServerSession)\b/.test(
            call.getExpression().getText(),
          ),
        )
        .map((call) => call.getText().slice(0, 250)),
    ),
  ];
}
export function extractServices(
  project: Project,
  relative: (path: string) => string,
): ServiceInfo[] {
  const services: ServiceInfo[] = [];
  for (const file of project.getSourceFiles()) {
    if (!/service/i.test(file.getFilePath())) continue;
    const nodes = file
      .getDescendants()
      .filter(
        (n) =>
          Node.isMethodDeclaration(n) ||
          Node.isFunctionDeclaration(n) ||
          Node.isArrowFunction(n) ||
          Node.isFunctionExpression(n),
      );
    for (const node of nodes) {
      const owner = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
      const name =
        Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node)
          ? node.getName()
          : (node.getParentIfKind(SyntaxKind.VariableDeclaration)?.getName() ??
            node.getParentIfKind(SyntaxKind.PropertyAssignment)?.getName());
      if (!name) continue;
      const symbol = owner ? `${owner}.${name}` : name;
      const calls = callsIn(node);
      const filePath = relative(file.getFilePath());
      services.push({
        id: `${filePath}#${symbol}`,
        name: symbol,
        file: filePath,
        line: node.getStartLineNumber(),
        calls,
        databaseOperations: calls.filter((c) => /\b(prisma|tx|db)\.\w+\.\w+/.test(c)),
        permissions: permissionsIn(node),
        rules: node
          .getDescendantsOfKind(SyntaxKind.IfStatement)
          .filter(
            (n) =>
              n.getThenStatement().getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0 ||
              Node.isThrowStatement(n.getThenStatement()),
          )
          .map((n) => n.getText().slice(0, 600)),
        arguments: Node.isFunctionLikeDeclaration(node)
          ? node.getParameters().map((p) => p.getText())
          : [],
        returnType: Node.isFunctionLikeDeclaration(node)
          ? node.getReturnType().getText().slice(0, 500)
          : 'unknown',
        snippet: node.getText().slice(0, 5000),
      });
    }
  }
  return services;
}
