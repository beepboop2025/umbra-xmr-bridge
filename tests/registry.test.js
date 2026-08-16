import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('MCP registry release contract', () => {
  it('binds the current registry schema to the matching OCI release', () => {
    const manifest = JSON.parse(read('server.json'));

    expect(manifest.$schema).toMatch(/\/2025-12-11\/server\.schema\.json$/);
    expect(manifest.name).toBe('io.github.beepboop2025/umbra-proof');
    expect(manifest.version).toBe('0.1.2');
    expect(manifest.packages).toEqual([
      expect.objectContaining({
        registryType: 'oci',
        identifier: 'ghcr.io/beepboop2025/umbra-proof-mcp:v0.1.2',
      }),
    ]);
  });

  it('pins release inputs and separates package-write from OIDC authority', () => {
    const dockerfile = read('Dockerfile.mcp');
    const workflow = read('.github/workflows/publish-mcp.yml');
    const [imageJob, registryJob] = workflow.split(/^  registry:/m);

    expect(dockerfile).toContain(
      'python:3.12-slim@sha256:dd29372629eeba2dd003fd9e9d35a5b8236c44727875a0364254b5127af88e65',
    );
    expect(workflow).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    expect(workflow).toContain('MCP_PUBLISHER_VERSION: "1.8.1"');
    expect(workflow).toContain(
      'MCP_PUBLISHER_SHA256: "a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc"',
    );
    expect(workflow).not.toContain('releases/latest');
    expect(workflow).not.toContain('| tar');
    expect(workflow).not.toContain('sudo ');
    expect(imageJob).toContain('packages: write');
    expect(imageJob).not.toContain('id-token: write');
    expect(registryJob).toContain('id-token: write');
    expect(registryJob).not.toContain('packages: write');
  });

  it('pins every third-party workflow action to an immutable commit', () => {
    const workflowDirectory = resolve(process.cwd(), '.github/workflows');
    const workflowFiles = readdirSync(workflowDirectory).filter((fileName) =>
      /\.ya?ml$/.test(fileName),
    );
    let actionCount = 0;

    for (const fileName of workflowFiles) {
      const workflow = read(`.github/workflows/${fileName}`);
      const actionRefs = workflow.matchAll(
        /uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)/g,
      );

      for (const [, action, ref] of actionRefs) {
        actionCount += 1;
        expect(ref, `${fileName}: ${action}@${ref}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }

    expect(actionCount).toBeGreaterThan(0);
  });
});
