/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// @ts-nocheck

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import lodash from 'lodash';
import mustache from 'mustache';

function flattenKeys(data, parentPath = []) {
  const keys = [];

  lodash.keys(data).forEach(key => {
    const value = data[key];
    const newPath = [...parentPath, key];

    if (Array.isArray(value)) {
      throw new TypeError(
        `Array is not supported in strings.yaml\nPath: "${newPath.join('.')}"`,
      );
    }

    if (lodash.isPlainObject(data[key])) {
      keys.push(...flattenKeys(data[key], [...parentPath, key]));
    } else {
      keys.push([...parentPath, key].join('.'));
    }
  });

  keys.sort();

  return keys;
}

function templateFn(content, partialType) {
  let typeStr = 'Record<T, string | number | boolean>';

  if (partialType) {
    typeStr = `Partial<${typeStr}>`;
  }

  return `/**
* This file is auto-generated. Please do not modify this file manually.
* Use the command \`yarn strings\` to regenerate this file.
*/
export type PrimitiveObject<T extends string> = ${typeStr}

export interface StringsMap {
    ${content}
}`;
}

async function generateStringTypes({
  input,
  output,
  context,
  preProcess,
  partialType,
}) {
  const content = await fs.promises.readFile(
    path.resolve(context, input),
    'utf8',
  );
  const parsedData = yaml.parse(content);

  const keys = flattenKeys(parsedData)
    .map(key => {
      const template = lodash.get(parsedData, key);
      const variables = mustache
        .parse(template)
        .filter(v => v[0] === 'name' || v[0] === '#' || v[0] === '&')
        .map(v => v[1])
        .filter(v => !v.startsWith('$'))
        .map(v => `'${v}'`);
      const uniqVariables = lodash.uniq(variables);
      const valueType =
        uniqVariables.length > 0
          ? `PrimitiveObject<${variables.join(' | ')}>`
          : 'unknown';

      return `'${key}': ${valueType}`;
    })
    .join('\n  ');

  let typesContent = templateFn(keys, partialType);

  if (typeof preProcess === 'function') {
    typesContent = await preProcess(typesContent);
  }

  return fs.promises.writeFile(
    path.resolve(context, output),
    typesContent,
    'utf8',
  );
}

export class GenerateStringTypesPlugin {
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    const { input, output, preProcess, partialType } = this.options;

    compiler.hooks.emit.tapAsync(
      'GenerateStringTypesPlugin',
      (compilation, callback) => {
        try {
          generateStringTypes({
            input,
            output,
            context: compiler.context,
            preProcess,
            partialType,
          }).then(
            () => callback(),
            e => callback(e),
          );
        } catch (e) {
          callback(e);
        }
      },
    );
  }
}
