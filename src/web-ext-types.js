#!/usr/bin/env node
import * as acorn from 'acorn'
import cac from 'cac'
import { walk } from 'estree-walker'
import fs from 'fs'
import path from 'path'
import { camel, castArrayIfExists, dedent, pascal } from 'radashi'
import * as sucrase from 'sucrase'

const cli = cac('find-literal-node')

cli
  .command(
    'generate <version>',
    'Generate types for a specific version of web-ext',
  )
  .option('-o, --output <file>', 'Where to write the output')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (version, options) => {
    try {
      // Fetch the program.js file for the specified version
      const url = `https://raw.githubusercontent.com/mozilla/web-ext/refs/tags/${version}/src/program.js`

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`)
      }

      const originalCode = await response.text()

      if (options.debug) {
        writeDebugFile('web-ext.original.js', originalCode)
      }

      // Step 1: Use Sucrase to strip Flow types
      const strippedCode = sucrase.transform(originalCode, {
        transforms: ['flow'],
      }).code

      // Step 2: Parse the code into an AST using Acorn
      const ast = acorn.parse(strippedCode, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      })

      if (options.debug) {
        writeDebugFile('web-ext.ast.json', JSON.stringify(ast, null, 2))
      }

      const commands = ['run', 'build', 'sign']
      const replacements = [
        [
          /\bAMO_BASE_URL\b/g,
          JSON.stringify('https://addons.mozilla.org/api/v5/'),
        ],
      ]
      const typeOverrides = {
        'sign/channel': `'listed' | 'unlisted'`,
      }

      const interfaces = commands.map((command) =>
        renderInterface(
          command,
          getCommandOptions(command, ast, strippedCode, replacements),
          typeOverrides,
        ),
      )

      const output = interfaces.join('\n\n')

      if (options.output) {
        fs.writeFileSync(options.output, output + '\n')
      } else {
        console.log(output)
      }
    } catch (error) {
      console.error(error)
    }
  })

cli.help()
try {
  cli.parse()
} catch (error) {
  if (error.name === 'CACError') {
    console.error(error.message)
  } else {
    console.error(error)
  }
  process.exit(1)
}

function renderInterface(command, options, typeOverrides) {
  const preferredAliases = new Set(['firefox-binary'])

  let output = ''

  for (const key in options) {
    const option = options[key]
    const preferredKey =
      castArrayIfExists(option.alias)?.find((alias) =>
        preferredAliases.has(alias),
      ) ?? key

    if (option.describe || option.default != null) {
      output += '/**\n'
      if (option.describe) {
        output += ` * ${option.describe.match(/(.{1,79}(?:\s|$))/g).join('\n * ')}\n`
      }
      if (option.default != null) {
        if (option.describe) {
          output += ' *\n'
        }
        output += ` * @default ${JSON.stringify(option.default)}\n`
      }
      output += ' */\n'
    }

    const optionPath = command + '/' + preferredKey

    let jsType = option.type
    if (typeOverrides[optionPath]) {
      jsType = typeOverrides[optionPath]
    } else if (jsType === 'array') {
      jsType = option.choices
        ? `(${option.choices.map((choice) => `'${choice}'`).join(' | ')})[]`
        : 'string[]'
    }
    if (!option.demandOption) {
      jsType += ' | undefined'
    }

    output += `${camel(preferredKey)}${option.demandOption || option.default != null ? '' : '?'}: ${jsType}\n`
  }

  return dedent`
    export interface ${pascal(command)}Options {
      ${output.trimEnd()}
    }
  `
}

function getCommandOptions(command, ast, code, replacements) {
  let done = false
  let result

  walk(ast, {
    enter(node, parent) {
      if (done) {
        return this.skip()
      }
      // Look for a Literal node with the command name
      if (node.type === 'Literal' && node.value === command) {
        // Ensure the parent is a CallExpression
        if (parent && parent.type === 'CallExpression') {
          const callee = parent.callee

          // Check if the callee is a MemberExpression with a property named "command"
          if (
            callee &&
            callee.type === 'MemberExpression' &&
            callee.property &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'command'
          ) {
            // Verify the Literal node is the first argument of the CallExpression
            if (parent.arguments[0] === node) {
              const { start, end } = parent.arguments[3]

              let optionsCode = code.slice(start, end)
              for (const [key, value] of replacements) {
                optionsCode = optionsCode.replace(key, value)
              }

              result = eval('(' + optionsCode + ')')
              done = true
            }
          }
        }
      }
    },
  })

  return result
}

function writeDebugFile(name, content) {
  const file = path.join('debug', name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
