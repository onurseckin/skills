import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedAgentManifest, validateUnifiedAgentManifest } from '../olt/scripts/src/authority/manifest-schema';
import { auditPermissionHealth } from '../olt/scripts/src/policy/permission-health';
import { loadRepoPolicy } from '../olt/scripts/src/policy/repo-policy';

const AGENTS_DIR = join(import.meta.dir, '..', 'olt', 'agents');
const PROVIDER_CONFIGS = new Set([
  'antigravity.yaml',
  'claude.yaml',
  'codex.yaml',
  'cursor.yaml',
  'openai.yaml',
  'generic.yaml',
]);

function run() {
  let allHealthy = true;
  const results: { agent: string; tier: number | string; tools: string; commands: number; spawns: number; status: string }[] = [];

  try {
    const files = readdirSync(AGENTS_DIR)
      .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !PROVIDER_CONFIGS.has(f));
    
    const policy = loadRepoPolicy();

    for (const file of files) {
      const filePath = join(AGENTS_DIR, file);
      const rawYaml = readFileSync(filePath, 'utf-8');
      
      let status = 'PASS';
      let tier: number | string = 'unknown';
      let tools = 'unknown';
      let commandsCount = 0;
      let spawnsCount = 0;

      try {
        const manifest = parseUnifiedAgentManifest(rawYaml, filePath);
        tier = manifest.tier;
        tools = `W:${manifest.tools.enable_write_tools} S:${manifest.tools.enable_subagent_tools}`;
        commandsCount = manifest.permissions.commands.length;
        spawnsCount = manifest.permissions.spawns.length;

        const validation = validateUnifiedAgentManifest(manifest);
        if (!validation.valid) {
          status = 'FAIL (Schema)';
          console.error(`\nErrors in ${file}:`);
          validation.errors.forEach(e => console.error(`  - ${e}`));
          allHealthy = false;
        } else {
          const health = auditPermissionHealth(manifest, policy);
          if (!health.healthy) {
            status = 'FAIL (Policy)';
            console.error(`\nErrors in ${file}:`);
            health.errors.forEach(e => console.error(`  - ${e}`));
            allHealthy = false;
          }
        }
      } catch (err) {
        status = 'FAIL (Parse)';
        console.error(`\nFailed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
        allHealthy = false;
      }

      results.push({
        agent: file.replace(/\.ya?ml$/, ''),
        tier,
        tools,
        commands: commandsCount,
        spawns: spawnsCount,
        status
      });
    }

    // Print ASCII table
    console.log('\nAgent Manifest Validation Results:');
    console.log('='.repeat(80));
    console.log(
      'Agent'.padEnd(20) + 
      'Tier'.padEnd(15) + 
      'Tools'.padEnd(15) + 
      'Commands'.padEnd(10) + 
      'Spawns'.padEnd(10) + 
      'Status'
    );
    console.log('-'.repeat(80));
    
    for (const res of results) {
      console.log(
        res.agent.padEnd(20) + 
        String(res.tier).padEnd(15) + 
        res.tools.padEnd(15) + 
        String(res.commands).padEnd(10) + 
        String(res.spawns).padEnd(10) + 
        res.status
      );
    }
    console.log('='.repeat(80));

  } catch (err) {
    console.error(`Failed to read agents directory: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!allHealthy) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
