#!/usr/bin/env node
import fs from 'fs'
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
  const { stdout: webextVersion } = await spawn('npm', [
    'view',
    'web-ext',
    'version',
  ])

  console.log('Current version of web-ext:', webextVersion)

  const pkgJson = JSON.parse(fs.readFileSync('npm/package.json', 'utf8'))

  const lastWebextVersion = pkgJson.metadata['web-ext.version']
  const currentVersion = pkgJson.version

  let nextVersion
  if (lastWebextVersion !== webextVersion) {
    nextVersion = webextVersion
  } else {
    const lastCommitTitle = await spawn('git', ['log', '-1', '--pretty=%B'])
    if (lastCommitTitle === currentVersion) {
      console.log('Nothing to release, skipping...')
      return
    }
    // Bump by a patch version.
    nextVersion = currentVersion.replace(
      /\.(\d+)$/,
      (_, patch) => '.' + (Number(patch) + 1),
    )
  }

  console.log('Generating types...')

  // Generate types
  await spawn('./dist/web-ext-types.js', [
    'generate',
    webextVersion,
    '-o',
    'npm/index.d.ts',
  ])

  // Update metadata
  pkgJson.metadata['web-ext.version'] = webextVersion
  fs.writeFileSync('npm/package.json', JSON.stringify(pkgJson, null, 2) + '\n')

  // Bump version
  await spawn('npm', ['version', nextVersion], { cwd: 'npm' })

  // Publish to npm
  await spawn('npm', ['publish', args.dryRun ? '--dry-run' : ''], {
    cwd: 'npm',
  })

  // Commit and push changes
  await spawn('git', ['add', 'npm'])
  await spawn('git', ['commit', '-m', nextVersion])
  if (!args.dryRun) {
    await spawn('git', ['push'])
  }

  console.log('Done!')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
