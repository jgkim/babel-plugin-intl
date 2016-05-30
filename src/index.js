/*
* Copyright 2016, Yahoo Inc. and James G. Kim
* Copyrights licensed under the New BSD License.
* See the accompanying LICENSE file for terms.
*/

import * as p from 'path';
import {writeFileSync} from 'fs';
import {sync as mkdirpSync} from 'mkdirp';
import printICUMessage from './print-icu-message';

const FUNCTION_NAMES = [
  'default',
];

const DESCRIPTOR_PROPS = new Set(['id', 'description', 'defaultMessage']);

export default function () {
  function getModuleSourceName(opts) {
    return opts.moduleSourceName || './intl';
  }

  function getMessageDescriptorKey(path) {
    if (path.isIdentifier()) {
      return path.node.name;
    }

    let evaluated = path.evaluate();
    if (evaluated.confident) {
      return evaluated.value;
    }

    throw path.buildCodeFrameError(
      '[intl] Messages must be statically evaluate-able for extraction'
    );
  }

  function getMessageDescriptorValue(path) {
    let evaluated = path.evaluate();
    if (evaluated.confident) {
      return evaluated.value;
    }

    throw path.buildCodeFrameError(
      '[intl] Messages must be statically evaluate-able for extraction'
    );
  }

  function createMessageDescriptor(propPaths) {
    return propPaths.reduce((hash, [keyPath, valuePath]) => {
      let key = getMessageDescriptorKey(keyPath);

      if (!DESCRIPTOR_PROPS.has(key)) {
        return hash;
      }

      let value = getMessageDescriptorValue(valuePath).trim();

      if (key === 'defaultMessage') {
        try {
          hash[key] = printICUMessage(value);
        } catch (parseError) {
          throw valuePath.buildCodeFrameError(
            '[intl] Message failed to parse. ' +
            'See: http://formatjs.io/guides/message-syntax/',
            parseError
          );
        }
      } else {
        hash[key] = value;
      }

      return hash;
    }, {});
  }

  function storeMessage({id, description, defaultMessage}, path, state) {
    const {opts, intl} = state;

    if (!(id && defaultMessage)) {
      throw path.buildCodeFrameError(
        '[intl] Message Descriptors require an `id` and `defaultMessage`'
      );
    }

    if (intl.messages.has(id)) {
      let existing = intl.messages.get(id);

      if (
        description !== existing.description ||
        defaultMessage !== existing.defaultMessage
      ) {
        throw path.buildCodeFrameError(
          `[intl] Duplicate message id: "${id}", ` +
          'but the `description` and/or `defaultMessage` are different'
        );
      }
    }

    if (opts.enforceDescriptions && !description) {
      throw path.buildCodeFrameError(
        '[intl] Message must have a `description`'
      );
    }

    intl.messages.set(id, {id, description, defaultMessage});
  }

  function referencesImport(path, mod, importedNames) {
    if (!path.isIdentifier()) {
      return false;
    }

    return importedNames.some((name) => path.referencesImport(mod, name));
  }

  return {
    visitor: {
      Program: {
        enter(path, state) {
          state.intl = {
            messages: new Map(),
          };
        },

        exit(path, state) {
          const {file, opts, intl} = state;
          const {basename, filename} = file.opts;

          let descriptors = [...intl.messages.values()];
          file.metadata['intl'] = {messages: descriptors};

          if (opts.messagesDir && descriptors.length > 0) {
            // Make sure the relative path is "absolute" before
            // joining it with the `messagesDir`.
            let relativePath = p.join(
              p.sep,
              p.relative(process.cwd(), filename)
            );

            let messagesFilename = p.join(
              opts.messagesDir,
              p.dirname(relativePath),
              basename + '.json'
            );

            let messagesFile = JSON.stringify(descriptors, null, 2);

            mkdirpSync(p.dirname(messagesFilename));
            writeFileSync(messagesFilename, messagesFile);
          }
        },
      },

      CallExpression(path, state) {
        const moduleSourceName = getModuleSourceName(state.opts);
        const callee = path.get('callee');

        if (referencesImport(callee, moduleSourceName, FUNCTION_NAMES)) {
          let messageObj = path.get('arguments')[0];

          if (!(messageObj && messageObj.isObjectExpression())) {
            throw path.buildCodeFrameError(
              `[intl] \`${callee.node.name}()\` must be ` +
              'called with an object expression'
            );
          }

          let properties = messageObj.get('properties');

          let descriptor = createMessageDescriptor(
            properties.map((prop) => [
              prop.get('key'),
              prop.get('value'),
            ])
          );

          if (!descriptor.defaultMessage) {
            throw path.buildCodeFrameError(
              '[intl] Message is missing a `defaultMessage`'
            );
          }

          storeMessage(descriptor, path, state);
        }
      },
    },
  };
}
