#!/usr/bin/env node
import mri from 'mri'
import spawn from 'tinyspawn'

async function main() {
  const args = mri(process.argv.slice(2), {
    boolean: ['dryRun'],
    alias: {
      'dry-run': 'dryRun',
    },
  })

  // Get latest web-ext version from npm
  const { stdout: version } = await spawn('npm', ['view', 'web-ext', 'version'])

  console.log(`Generating types for web-ext ${version}...`)

  // Generate types
  await spawn('./dist/web-ext-types.js', [
    'generate',
    version,
    '-o',
    'npm/index.d.ts',
  ])

  // Bump version
  await spawn('npm', ['version', version], { cwd: 'npm' })

  // Publish to npm
  await spawn(
    'npm',
    [
      'publish',
      '--token',
      process.env.NPM_TOKEN,
      args.dryRun ? '--dry-run' : '',
    ],
    {
      cwd: 'npm',
    },
  )

  // Commit and push changes
  await spawn('git', ['add', 'npm'])
  await spawn('git', ['commit', '-m', version])
  if (!args.dryRun) {
    await spawn('git', ['push'])
  }

  console.log('Done!')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
