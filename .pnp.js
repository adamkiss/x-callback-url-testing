#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["inquirer", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inquirer-7.0.0-9e2b032dde77da1db5db804758b8fea3a970519a/node_modules/inquirer/"),
      packageDependencies: new Map([
        ["ansi-escapes", "4.2.1"],
        ["chalk", "2.4.2"],
        ["cli-cursor", "3.1.0"],
        ["cli-width", "2.2.0"],
        ["external-editor", "3.1.0"],
        ["figures", "3.0.0"],
        ["lodash", "4.17.15"],
        ["mute-stream", "0.0.8"],
        ["run-async", "2.3.0"],
        ["rxjs", "6.5.3"],
        ["string-width", "4.1.0"],
        ["strip-ansi", "5.2.0"],
        ["through", "2.3.8"],
        ["inquirer", "7.0.0"],
      ]),
    }],
    ["6.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inquirer-6.5.2-ad50942375d036d327ff528c08bd5fab089928ca/node_modules/inquirer/"),
      packageDependencies: new Map([
        ["ansi-escapes", "3.2.0"],
        ["chalk", "2.4.2"],
        ["cli-cursor", "2.1.0"],
        ["cli-width", "2.2.0"],
        ["external-editor", "3.1.0"],
        ["figures", "2.0.0"],
        ["lodash", "4.17.15"],
        ["mute-stream", "0.0.7"],
        ["run-async", "2.3.0"],
        ["rxjs", "6.5.3"],
        ["string-width", "2.1.1"],
        ["strip-ansi", "5.2.0"],
        ["through", "2.3.8"],
        ["inquirer", "6.5.2"],
      ]),
    }],
  ])],
  ["ansi-escapes", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-escapes-4.2.1-4dccdb846c3eee10f6d64dea66273eab90c37228/node_modules/ansi-escapes/"),
      packageDependencies: new Map([
        ["type-fest", "0.5.2"],
        ["ansi-escapes", "4.2.1"],
      ]),
    }],
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-escapes-3.2.0-8780b98ff9dbf5638152d1f1fe5c1d7b4442976b/node_modules/ansi-escapes/"),
      packageDependencies: new Map([
        ["ansi-escapes", "3.2.0"],
      ]),
    }],
  ])],
  ["type-fest", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-fest-0.5.2-d6ef42a0356c6cd45f49485c3b6281fc148e48a2/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.5.2"],
      ]),
    }],
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-fest-0.6.0-8d2a2370d3df886eb5c90ada1c5bf6188acf838b/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.6.0"],
      ]),
    }],
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-fest-0.4.1-8bdf77743385d8a4f13ba95f610f5ccd68c728f8/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.4.1"],
      ]),
    }],
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-fest-0.3.1-63d00d204e059474fe5e1b7c011112bbd1dc29e1/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.3.1"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-flag-2.0.0-e8207af1cc7b30d446cc70b734b5e8be18f88d51/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "2.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
      ]),
    }],
  ])],
  ["cli-cursor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-cursor-3.1.0-264305a7ae490d1d03bf0c9ba7c925d1753af307/node_modules/cli-cursor/"),
      packageDependencies: new Map([
        ["restore-cursor", "3.1.0"],
        ["cli-cursor", "3.1.0"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-cursor-2.1.0-b35dac376479facc3e94747d41d0d0f5238ffcb5/node_modules/cli-cursor/"),
      packageDependencies: new Map([
        ["restore-cursor", "2.0.0"],
        ["cli-cursor", "2.1.0"],
      ]),
    }],
  ])],
  ["restore-cursor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-restore-cursor-3.1.0-39f67c54b3a7a58cea5236d95cf0034239631f7e/node_modules/restore-cursor/"),
      packageDependencies: new Map([
        ["onetime", "5.1.0"],
        ["signal-exit", "3.0.2"],
        ["restore-cursor", "3.1.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-restore-cursor-2.0.0-9f7ee287f82fd326d4fd162923d62129eee0dfaf/node_modules/restore-cursor/"),
      packageDependencies: new Map([
        ["onetime", "2.0.1"],
        ["signal-exit", "3.0.2"],
        ["restore-cursor", "2.0.0"],
      ]),
    }],
  ])],
  ["onetime", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-onetime-5.1.0-fff0f3c91617fe62bb50189636e99ac8a6df7be5/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
        ["onetime", "5.1.0"],
      ]),
    }],
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-onetime-2.0.1-067428230fd67443b2794b22bba528b6867962d4/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "1.2.0"],
        ["onetime", "2.0.1"],
      ]),
    }],
  ])],
  ["mimic-fn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
      ]),
    }],
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mimic-fn-1.2.0-820c86a39334640e99516928bd03fca88057d022/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "1.2.0"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.2"],
      ]),
    }],
  ])],
  ["cli-width", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639/node_modules/cli-width/"),
      packageDependencies: new Map([
        ["cli-width", "2.2.0"],
      ]),
    }],
  ])],
  ["external-editor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495/node_modules/external-editor/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
        ["iconv-lite", "0.4.24"],
        ["tmp", "0.0.33"],
        ["external-editor", "3.1.0"],
      ]),
    }],
  ])],
  ["chardet", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e/node_modules/chardet/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
    ["0.4.19", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.19-f7468f60135f5e5dad3399c0a81be9a1603a082b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["iconv-lite", "0.4.19"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["tmp", new Map([
    ["0.0.33", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9/node_modules/tmp/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
        ["tmp", "0.0.33"],
      ]),
    }],
  ])],
  ["os-tmpdir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
      ]),
    }],
  ])],
  ["figures", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-figures-3.0.0-756275c964646163cc6f9197c7a0295dbfd04de9/node_modules/figures/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["figures", "3.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-figures-2.0.0-3ab1a2d2a62c8bfb431a0c94cb797a2fce27c962/node_modules/figures/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["figures", "2.0.0"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
  ["mute-stream", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.8-1630c42b2251ff81e2a283de96a5497ea92e5e0d/node_modules/mute-stream/"),
      packageDependencies: new Map([
        ["mute-stream", "0.0.8"],
      ]),
    }],
    ["0.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.7-3075ce93bc21b8fab43e1bc4da7e8115ed1e7bab/node_modules/mute-stream/"),
      packageDependencies: new Map([
        ["mute-stream", "0.0.7"],
      ]),
    }],
  ])],
  ["run-async", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0/node_modules/run-async/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
        ["run-async", "2.3.0"],
      ]),
    }],
  ])],
  ["is-promise", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa/node_modules/is-promise/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
      ]),
    }],
  ])],
  ["rxjs", new Map([
    ["6.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rxjs-6.5.3-510e26317f4db91a7eb1de77d9dd9ba0a4899a3a/node_modules/rxjs/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
        ["rxjs", "6.5.3"],
      ]),
    }],
  ])],
  ["tslib", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a/node_modules/tslib/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-width-4.1.0-ba846d1daa97c3c596155308063e075ed1c99aff/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
        ["is-fullwidth-code-point", "3.0.0"],
        ["strip-ansi", "5.2.0"],
        ["string-width", "4.1.0"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "4.0.0"],
        ["string-width", "2.1.1"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-width-3.1.0-22767be21b62af1081574306f69ac51b62203961/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "5.2.0"],
        ["string-width", "3.1.0"],
      ]),
    }],
  ])],
  ["emoji-regex", new Map([
    ["8.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
      ]),
    }],
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "3.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
        ["strip-ansi", "5.2.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
        ["strip-ansi", "4.0.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
      ]),
    }],
  ])],
  ["through", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
      ]),
    }],
  ])],
  ["kleur", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e/node_modules/kleur/"),
      packageDependencies: new Map([
        ["kleur", "3.0.3"],
      ]),
    }],
  ])],
  ["micro", new Map([
    ["9.3.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-micro-9.3.4-745a494e53c8916f64fb6a729f8cbf2a506b35ad/node_modules/micro/"),
      packageDependencies: new Map([
        ["arg", "4.1.0"],
        ["content-type", "1.0.4"],
        ["is-stream", "1.1.0"],
        ["raw-body", "2.3.2"],
        ["micro", "9.3.4"],
      ]),
    }],
  ])],
  ["arg", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arg-4.1.0-583c518199419e0037abb74062c37f8519e575f0/node_modules/arg/"),
      packageDependencies: new Map([
        ["arg", "4.1.0"],
      ]),
    }],
  ])],
  ["content-type", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/"),
      packageDependencies: new Map([
        ["content-type", "1.0.4"],
      ]),
    }],
  ])],
  ["is-stream", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44/node_modules/is-stream/"),
      packageDependencies: new Map([
        ["is-stream", "1.1.0"],
      ]),
    }],
  ])],
  ["raw-body", new Map([
    ["2.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-raw-body-2.3.2-bcd60c77d3eb93cde0050295c3f379389bc88f89/node_modules/raw-body/"),
      packageDependencies: new Map([
        ["bytes", "3.0.0"],
        ["http-errors", "1.6.2"],
        ["iconv-lite", "0.4.19"],
        ["unpipe", "1.0.0"],
        ["raw-body", "2.3.2"],
      ]),
    }],
  ])],
  ["bytes", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "3.0.0"],
      ]),
    }],
  ])],
  ["http-errors", new Map([
    ["1.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-http-errors-1.6.2-0a002cc85707192a7e7946ceedc11155f60ec736/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.1"],
        ["inherits", "2.0.3"],
        ["setprototypeof", "1.0.3"],
        ["statuses", "1.5.0"],
        ["http-errors", "1.6.2"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-depd-1.1.1-5783b4e1c459f06fa5ca27f991f3d06e7a310359/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.1"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
  ])],
  ["setprototypeof", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-setprototypeof-1.0.3-66567e37043eeb4f04d91bd658c0cbefb55b8e04/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.0.3"],
      ]),
    }],
  ])],
  ["statuses", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.5.0"],
      ]),
    }],
  ])],
  ["unpipe", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/"),
      packageDependencies: new Map([
        ["unpipe", "1.0.0"],
      ]),
    }],
  ])],
  ["xcall", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xcall-1.0.4-26f7631f46197584117286951cb595b9d84db166/node_modules/xcall/"),
      packageDependencies: new Map([
        ["promised-exec", "1.0.1"],
        ["querystring", "0.2.0"],
        ["xcall", "1.0.4"],
      ]),
    }],
  ])],
  ["promised-exec", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-promised-exec-1.0.1-50a11585798acb3b86fb613e103613333a30950a/node_modules/promised-exec/"),
      packageDependencies: new Map([
        ["q", "1.5.1"],
        ["promised-exec", "1.0.1"],
      ]),
    }],
  ])],
  ["q", new Map([
    ["1.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-q-1.5.1-7e32f75b41381291d04611f1bf14109ac00651d7/node_modules/q/"),
      packageDependencies: new Map([
        ["q", "1.5.1"],
      ]),
    }],
  ])],
  ["querystring", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-querystring-0.2.0-b209849203bb25df820da756e747005878521620/node_modules/querystring/"),
      packageDependencies: new Map([
        ["querystring", "0.2.0"],
      ]),
    }],
  ])],
  ["xo", new Map([
    ["0.25.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xo-0.25.3-feb624c35943f3575ad4668cd0b7b74a1d4884d2/node_modules/xo/"),
      packageDependencies: new Map([
        ["arrify", "2.0.1"],
        ["debug", "4.1.1"],
        ["eslint", "6.4.0"],
        ["eslint-config-prettier", "6.3.0"],
        ["eslint-config-xo", "0.27.1"],
        ["eslint-formatter-pretty", "2.1.1"],
        ["eslint-plugin-ava", "9.0.0"],
        ["eslint-plugin-eslint-comments", "3.1.2"],
        ["eslint-plugin-import", "2.18.2"],
        ["eslint-plugin-no-use-extend-native", "0.4.1"],
        ["eslint-plugin-node", "10.0.0"],
        ["eslint-plugin-prettier", "3.1.1"],
        ["eslint-plugin-promise", "4.2.1"],
        ["eslint-plugin-unicorn", "12.0.1"],
        ["find-cache-dir", "3.0.0"],
        ["get-stdin", "7.0.0"],
        ["globby", "9.2.0"],
        ["has-flag", "4.0.0"],
        ["lodash.isequal", "4.5.0"],
        ["lodash.mergewith", "4.6.2"],
        ["meow", "5.0.0"],
        ["multimatch", "4.0.0"],
        ["open-editor", "2.0.1"],
        ["path-exists", "4.0.0"],
        ["pkg-conf", "3.1.0"],
        ["prettier", "1.18.2"],
        ["resolve-cwd", "3.0.0"],
        ["resolve-from", "5.0.0"],
        ["semver", "6.3.0"],
        ["slash", "3.0.0"],
        ["update-notifier", "3.0.1"],
        ["xo-init", "0.7.0"],
        ["xo", "0.25.3"],
      ]),
    }],
  ])],
  ["arrify", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arrify-2.0.1-c9655e9331e0abcd588d2a7cad7e9956f66701fa/node_modules/arrify/"),
      packageDependencies: new Map([
        ["arrify", "2.0.1"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.1.1"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
  ])],
  ["eslint", new Map([
    ["6.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-6.4.0-5aa9227c3fbe921982b2eda94ba0d7fae858611a/node_modules/eslint/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.5.5"],
        ["ajv", "6.10.2"],
        ["chalk", "2.4.2"],
        ["cross-spawn", "6.0.5"],
        ["debug", "4.1.1"],
        ["doctrine", "3.0.0"],
        ["eslint-scope", "5.0.0"],
        ["eslint-utils", "1.4.2"],
        ["eslint-visitor-keys", "1.1.0"],
        ["espree", "6.1.1"],
        ["esquery", "1.0.1"],
        ["esutils", "2.0.3"],
        ["file-entry-cache", "5.0.1"],
        ["functional-red-black-tree", "1.0.1"],
        ["glob-parent", "5.1.0"],
        ["globals", "11.12.0"],
        ["ignore", "4.0.6"],
        ["import-fresh", "3.1.0"],
        ["imurmurhash", "0.1.4"],
        ["inquirer", "6.5.2"],
        ["is-glob", "4.0.1"],
        ["js-yaml", "3.13.1"],
        ["json-stable-stringify-without-jsonify", "1.0.1"],
        ["levn", "0.3.0"],
        ["lodash", "4.17.15"],
        ["minimatch", "3.0.4"],
        ["mkdirp", "0.5.1"],
        ["natural-compare", "1.4.0"],
        ["optionator", "0.8.2"],
        ["progress", "2.0.3"],
        ["regexpp", "2.0.1"],
        ["semver", "6.3.0"],
        ["strip-ansi", "5.2.0"],
        ["strip-json-comments", "3.0.1"],
        ["table", "5.4.6"],
        ["text-table", "0.2.0"],
        ["v8-compile-cache", "2.1.0"],
        ["eslint", "6.4.0"],
      ]),
    }],
  ])],
  ["@babel/code-frame", new Map([
    ["7.5.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@babel-code-frame-7.5.5-bc0782f6d69f7b7d49531219699b988f669a8f9d/node_modules/@babel/code-frame/"),
      packageDependencies: new Map([
        ["@babel/highlight", "7.5.0"],
        ["@babel/code-frame", "7.5.5"],
      ]),
    }],
  ])],
  ["@babel/highlight", new Map([
    ["7.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@babel-highlight-7.5.0-56d11312bd9248fa619591d02472be6e8cb32540/node_modules/@babel/highlight/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["esutils", "2.0.3"],
        ["js-tokens", "4.0.0"],
        ["@babel/highlight", "7.5.0"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
      ]),
    }],
  ])],
  ["js-tokens", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/"),
      packageDependencies: new Map([
        ["js-tokens", "4.0.0"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["6.10.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ajv-6.10.2-d3cea04d6b017b2894ad69040fec8b623eb4bd52/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "2.0.1"],
        ["fast-json-stable-stringify", "2.0.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.2.2"],
        ["ajv", "6.10.2"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-deep-equal-2.0.1-7b05218ddf9667bf7f370bf7fdb2cb15fdd0aa49/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "2.0.1"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-json-stable-stringify-2.0.0-d5142c0caee6b1189f87d3a76111064f86c8bbf2/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.0.0"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
        ["uri-js", "4.2.2"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["6.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
        ["path-key", "2.0.1"],
        ["semver", "5.7.1"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "6.0.5"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cross-spawn-5.1.0-e8bd0efee58fcff6f8f94510a0a554bbfa235449/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["lru-cache", "4.1.5"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "5.1.0"],
      ]),
    }],
  ])],
  ["nice-try", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
        ["shebang-command", "1.2.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["doctrine", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961/node_modules/doctrine/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
        ["doctrine", "3.0.0"],
      ]),
    }],
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-doctrine-1.5.0-379dce730f6166f76cefa4e6707a159b02c5a6fa/node_modules/doctrine/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
        ["isarray", "1.0.0"],
        ["doctrine", "1.5.0"],
      ]),
    }],
  ])],
  ["eslint-scope", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-scope-5.0.0-e87c8887c73e8d1ec84f1ca591645c358bfc8fb9/node_modules/eslint-scope/"),
      packageDependencies: new Map([
        ["esrecurse", "4.2.1"],
        ["estraverse", "4.3.0"],
        ["eslint-scope", "5.0.0"],
      ]),
    }],
  ])],
  ["esrecurse", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esrecurse-4.2.1-007a3b9fdbc2b3bb87e4879ea19c92fdbd3942cf/node_modules/esrecurse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
        ["esrecurse", "4.2.1"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
      ]),
    }],
  ])],
  ["eslint-utils", new Map([
    ["1.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-utils-1.4.2-166a5180ef6ab7eb462f162fd0e6f2463d7309ab/node_modules/eslint-utils/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "1.1.0"],
        ["eslint-utils", "1.4.2"],
      ]),
    }],
  ])],
  ["eslint-visitor-keys", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-visitor-keys-1.1.0-e2a82cea84ff246ad6fb57f9bde5b46621459ec2/node_modules/eslint-visitor-keys/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "1.1.0"],
      ]),
    }],
  ])],
  ["espree", new Map([
    ["6.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-espree-6.1.1-7f80e5f7257fc47db450022d723e356daeb1e5de/node_modules/espree/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
        ["acorn-jsx", "5.0.2"],
        ["eslint-visitor-keys", "1.1.0"],
        ["espree", "6.1.1"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
      ]),
    }],
  ])],
  ["acorn-jsx", new Map([
    ["5.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-jsx-5.0.2-84b68ea44b373c4f8686023a551f61a21b7c4a4f/node_modules/acorn-jsx/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
        ["acorn-jsx", "5.0.2"],
      ]),
    }],
  ])],
  ["esquery", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esquery-1.0.1-406c51658b1f5991a5f9b62b1dc25b00e3e5c708/node_modules/esquery/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
        ["esquery", "1.0.1"],
      ]),
    }],
  ])],
  ["file-entry-cache", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-file-entry-cache-5.0.1-ca0f6efa6dd3d561333fb14515065c2fafdf439c/node_modules/file-entry-cache/"),
      packageDependencies: new Map([
        ["flat-cache", "2.0.1"],
        ["file-entry-cache", "5.0.1"],
      ]),
    }],
  ])],
  ["flat-cache", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0/node_modules/flat-cache/"),
      packageDependencies: new Map([
        ["flatted", "2.0.1"],
        ["rimraf", "2.6.3"],
        ["write", "1.0.3"],
        ["flat-cache", "2.0.1"],
      ]),
    }],
  ])],
  ["flatted", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08/node_modules/flatted/"),
      packageDependencies: new Map([
        ["flatted", "2.0.1"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["2.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.4"],
        ["rimraf", "2.6.3"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.4"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["write", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3/node_modules/write/"),
      packageDependencies: new Map([
        ["mkdirp", "0.5.1"],
        ["write", "1.0.3"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
      ]),
    }],
  ])],
  ["functional-red-black-tree", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-functional-red-black-tree-1.0.1-1b0ab3bd553b2a0d6399d29c0e3ea0b252078327/node_modules/functional-red-black-tree/"),
      packageDependencies: new Map([
        ["functional-red-black-tree", "1.0.1"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-parent-5.1.0-5f4c1d1e748d30cd73ad2944b3577a81b081e8c2/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.1"],
        ["glob-parent", "5.1.0"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "3.1.0"],
        ["path-dirname", "1.0.2"],
        ["glob-parent", "3.1.0"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.1"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "3.1.0"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["globals", new Map([
    ["11.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-globals-11.12.0-ab8795338868a0babd8525758018c2a7eb95c42e/node_modules/globals/"),
      packageDependencies: new Map([
        ["globals", "11.12.0"],
      ]),
    }],
  ])],
  ["ignore", new Map([
    ["4.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "4.0.6"],
      ]),
    }],
    ["5.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ignore-5.1.4-84b7b3dbe64552b6ef0eca99f6743dbec6d97adf/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "5.1.4"],
      ]),
    }],
  ])],
  ["import-fresh", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-import-fresh-3.1.0-6d33fa1dcef6df930fae003446f33415af905118/node_modules/import-fresh/"),
      packageDependencies: new Map([
        ["parent-module", "1.0.1"],
        ["resolve-from", "4.0.0"],
        ["import-fresh", "3.1.0"],
      ]),
    }],
  ])],
  ["parent-module", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2/node_modules/parent-module/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
        ["parent-module", "1.0.1"],
      ]),
    }],
  ])],
  ["callsites", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73/node_modules/callsites/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "4.0.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["3.13.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "4.0.1"],
        ["js-yaml", "3.13.1"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["esprima", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
      ]),
    }],
  ])],
  ["json-stable-stringify-without-jsonify", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651/node_modules/json-stable-stringify-without-jsonify/"),
      packageDependencies: new Map([
        ["json-stable-stringify-without-jsonify", "1.0.1"],
      ]),
    }],
  ])],
  ["levn", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["levn", "0.3.0"],
      ]),
    }],
  ])],
  ["prelude-ls", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
      ]),
    }],
  ])],
  ["type-check", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
      ]),
    }],
  ])],
  ["natural-compare", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7/node_modules/natural-compare/"),
      packageDependencies: new Map([
        ["natural-compare", "1.4.0"],
      ]),
    }],
  ])],
  ["optionator", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-optionator-0.8.2-364c5e409d3f4d6301d6c0b4c05bba50180aeb64/node_modules/optionator/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
        ["fast-levenshtein", "2.0.6"],
        ["levn", "0.3.0"],
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["wordwrap", "1.0.0"],
        ["optionator", "0.8.2"],
      ]),
    }],
  ])],
  ["deep-is", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
      ]),
    }],
  ])],
  ["fast-levenshtein", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/"),
      packageDependencies: new Map([
        ["fast-levenshtein", "2.0.6"],
      ]),
    }],
  ])],
  ["wordwrap", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wordwrap-1.0.0-27584810891456a4171c8d0226441ade90cbcaeb/node_modules/wordwrap/"),
      packageDependencies: new Map([
        ["wordwrap", "1.0.0"],
      ]),
    }],
  ])],
  ["progress", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-progress-2.0.3-7e8cf8d8f5b8f239c1bc68beb4eb78567d572ef8/node_modules/progress/"),
      packageDependencies: new Map([
        ["progress", "2.0.3"],
      ]),
    }],
  ])],
  ["regexpp", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regexpp-2.0.1-8d19d31cf632482b589049f8281f93dbcba4d07f/node_modules/regexpp/"),
      packageDependencies: new Map([
        ["regexpp", "2.0.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regexpp-3.0.0-dd63982ee3300e67b41c1956f850aa680d9d330e/node_modules/regexpp/"),
      packageDependencies: new Map([
        ["regexpp", "3.0.0"],
      ]),
    }],
  ])],
  ["strip-json-comments", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "3.0.1"],
      ]),
    }],
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "2.0.1"],
      ]),
    }],
  ])],
  ["table", new Map([
    ["5.4.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-table-5.4.6-1292d19500ce3f86053b05f0e8e7e4a3bb21079e/node_modules/table/"),
      packageDependencies: new Map([
        ["ajv", "6.10.2"],
        ["lodash", "4.17.15"],
        ["slice-ansi", "2.1.0"],
        ["string-width", "3.1.0"],
        ["table", "5.4.6"],
      ]),
    }],
  ])],
  ["slice-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636/node_modules/slice-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["astral-regex", "1.0.0"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["slice-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["astral-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9/node_modules/astral-regex/"),
      packageDependencies: new Map([
        ["astral-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["text-table", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4/node_modules/text-table/"),
      packageDependencies: new Map([
        ["text-table", "0.2.0"],
      ]),
    }],
  ])],
  ["v8-compile-cache", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-v8-compile-cache-2.1.0-e14de37b31a6d194f5690d67efc4e7f6fc6ab30e/node_modules/v8-compile-cache/"),
      packageDependencies: new Map([
        ["v8-compile-cache", "2.1.0"],
      ]),
    }],
  ])],
  ["eslint-config-prettier", new Map([
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-config-prettier-6.3.0-e73b48e59dc49d950843f3eb96d519e2248286a3/node_modules/eslint-config-prettier/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["get-stdin", "6.0.0"],
        ["eslint-config-prettier", "6.3.0"],
      ]),
    }],
  ])],
  ["get-stdin", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-stdin-6.0.0-9e09bf712b360ab9225e812048f71fde9c89657b/node_modules/get-stdin/"),
      packageDependencies: new Map([
        ["get-stdin", "6.0.0"],
      ]),
    }],
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-stdin-7.0.0-8d5de98f15171a125c5e516643c7a6d0ea8a96f6/node_modules/get-stdin/"),
      packageDependencies: new Map([
        ["get-stdin", "7.0.0"],
      ]),
    }],
  ])],
  ["eslint-config-xo", new Map([
    ["0.27.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-config-xo-0.27.1-e302231d4c054e855865c0f7c700ade23f506552/node_modules/eslint-config-xo/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["eslint-config-xo", "0.27.1"],
      ]),
    }],
  ])],
  ["eslint-formatter-pretty", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-formatter-pretty-2.1.1-0794a1009195d14e448053fe99667413b7d02e44/node_modules/eslint-formatter-pretty/"),
      packageDependencies: new Map([
        ["ansi-escapes", "3.2.0"],
        ["chalk", "2.4.2"],
        ["eslint-rule-docs", "1.1.158"],
        ["log-symbols", "2.2.0"],
        ["plur", "3.1.1"],
        ["string-width", "2.1.1"],
        ["supports-hyperlinks", "1.0.1"],
        ["eslint-formatter-pretty", "2.1.1"],
      ]),
    }],
  ])],
  ["eslint-rule-docs", new Map([
    ["1.1.158", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-rule-docs-1.1.158-aa85789f11b164ee5f9f8be38aa98456bf20dade/node_modules/eslint-rule-docs/"),
      packageDependencies: new Map([
        ["eslint-rule-docs", "1.1.158"],
      ]),
    }],
  ])],
  ["log-symbols", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-log-symbols-2.2.0-5740e1c5d6f0dfda4ad9323b5332107ef6b4c40a/node_modules/log-symbols/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["log-symbols", "2.2.0"],
      ]),
    }],
  ])],
  ["plur", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-plur-3.1.1-60267967866a8d811504fe58f2faaba237546a5b/node_modules/plur/"),
      packageDependencies: new Map([
        ["irregular-plurals", "2.0.0"],
        ["plur", "3.1.1"],
      ]),
    }],
  ])],
  ["irregular-plurals", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-irregular-plurals-2.0.0-39d40f05b00f656d0b7fa471230dd3b714af2872/node_modules/irregular-plurals/"),
      packageDependencies: new Map([
        ["irregular-plurals", "2.0.0"],
      ]),
    }],
  ])],
  ["supports-hyperlinks", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-hyperlinks-1.0.1-71daedf36cc1060ac5100c351bb3da48c29c0ef7/node_modules/supports-hyperlinks/"),
      packageDependencies: new Map([
        ["has-flag", "2.0.0"],
        ["supports-color", "5.5.0"],
        ["supports-hyperlinks", "1.0.1"],
      ]),
    }],
  ])],
  ["eslint-plugin-ava", new Map([
    ["9.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-ava-9.0.0-a8d569ae7127aa640e344c46d1f288976543b1bd/node_modules/eslint-plugin-ava/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["deep-strict-equal", "0.2.0"],
        ["enhance-visitors", "1.0.0"],
        ["espree", "6.1.1"],
        ["espurify", "2.0.1"],
        ["import-modules", "1.1.0"],
        ["pkg-dir", "4.2.0"],
        ["resolve-from", "5.0.0"],
        ["eslint-plugin-ava", "9.0.0"],
      ]),
    }],
  ])],
  ["deep-strict-equal", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deep-strict-equal-0.2.0-4a078147a8ab57f6a0d4f5547243cd22f44eb4e4/node_modules/deep-strict-equal/"),
      packageDependencies: new Map([
        ["core-assert", "0.2.1"],
        ["deep-strict-equal", "0.2.0"],
      ]),
    }],
  ])],
  ["core-assert", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-core-assert-0.2.1-f85e2cf9bfed28f773cc8b3fa5c5b69bdc02fe3f/node_modules/core-assert/"),
      packageDependencies: new Map([
        ["buf-compare", "1.0.1"],
        ["is-error", "2.2.2"],
        ["core-assert", "0.2.1"],
      ]),
    }],
  ])],
  ["buf-compare", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-buf-compare-1.0.1-fef28da8b8113a0a0db4430b0b6467b69730b34a/node_modules/buf-compare/"),
      packageDependencies: new Map([
        ["buf-compare", "1.0.1"],
      ]),
    }],
  ])],
  ["is-error", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-error-2.2.2-c10ade187b3c93510c5470a5567833ee25649843/node_modules/is-error/"),
      packageDependencies: new Map([
        ["is-error", "2.2.2"],
      ]),
    }],
  ])],
  ["enhance-visitors", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-enhance-visitors-1.0.0-aa945d05da465672a1ebd38fee2ed3da8518e95a/node_modules/enhance-visitors/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
        ["enhance-visitors", "1.0.0"],
      ]),
    }],
  ])],
  ["espurify", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-espurify-2.0.1-c25b3bb613863daa142edcca052370a1a459f41d/node_modules/espurify/"),
      packageDependencies: new Map([
        ["espurify", "2.0.1"],
      ]),
    }],
  ])],
  ["import-modules", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-import-modules-1.1.0-748db79c5cc42bb9701efab424f894e72600e9dc/node_modules/import-modules/"),
      packageDependencies: new Map([
        ["import-modules", "1.1.0"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["pkg-dir", "4.2.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pkg-dir-2.0.0-f6d5d1109e19d63edf428e0bd57e12777615334b/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["pkg-dir", "2.0.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "5.0.0"],
        ["path-exists", "4.0.0"],
        ["find-up", "4.1.0"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "2.0.0"],
        ["find-up", "2.1.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-up-3.0.0-49169f1d7993430646da61ecc5ae355c21c97b73/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "3.0.0"],
        ["find-up", "3.0.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "4.1.0"],
        ["locate-path", "5.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "2.0.0"],
        ["path-exists", "3.0.0"],
        ["locate-path", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-locate-path-3.0.0-dbec3b3ab759758071b58fe59fc41871af21400e/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "3.0.0"],
        ["path-exists", "3.0.0"],
        ["locate-path", "3.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "2.2.1"],
        ["p-locate", "4.1.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "1.3.0"],
        ["p-locate", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-locate-3.0.0-322d69a05c0264b25997d9f40cd8a891ab0064a4/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "2.2.1"],
        ["p-locate", "3.0.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-limit-2.2.1-aa07a788cc3151c939b5131f63570f0dd2009537/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
        ["p-limit", "2.2.1"],
      ]),
    }],
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
        ["p-limit", "1.3.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "4.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "3.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-eslint-comments", new Map([
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-eslint-comments-3.1.2-4ef6c488dbe06aa1627fea107b3e5d059fc8a395/node_modules/eslint-plugin-eslint-comments/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["escape-string-regexp", "1.0.5"],
        ["ignore", "5.1.4"],
        ["eslint-plugin-eslint-comments", "3.1.2"],
      ]),
    }],
  ])],
  ["eslint-plugin-import", new Map([
    ["2.18.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-import-2.18.2-02f1180b90b077b33d447a17a2326ceb400aceb6/node_modules/eslint-plugin-import/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["array-includes", "3.0.3"],
        ["contains-path", "0.1.0"],
        ["debug", "2.6.9"],
        ["doctrine", "1.5.0"],
        ["eslint-import-resolver-node", "0.3.2"],
        ["eslint-module-utils", "2.4.1"],
        ["has", "1.0.3"],
        ["minimatch", "3.0.4"],
        ["object.values", "1.1.0"],
        ["read-pkg-up", "2.0.0"],
        ["resolve", "1.12.0"],
        ["eslint-plugin-import", "2.18.2"],
      ]),
    }],
  ])],
  ["array-includes", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-includes-3.0.3-184b48f62d92d7452bb31b323165c7f8bd02266d/node_modules/array-includes/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.14.2"],
        ["array-includes", "3.0.3"],
      ]),
    }],
  ])],
  ["define-properties", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-define-properties-1.1.3-cf88da6cbee26fe6db7094f61d870cbd84cee9f1/node_modules/define-properties/"),
      packageDependencies: new Map([
        ["object-keys", "1.1.1"],
        ["define-properties", "1.1.3"],
      ]),
    }],
  ])],
  ["object-keys", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-keys-1.1.1-1c47f272df277f3b1daf061677d9c82e2322c60e/node_modules/object-keys/"),
      packageDependencies: new Map([
        ["object-keys", "1.1.1"],
      ]),
    }],
  ])],
  ["es-abstract", new Map([
    ["1.14.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-es-abstract-1.14.2-7ce108fad83068c8783c3cdf62e504e084d8c497/node_modules/es-abstract/"),
      packageDependencies: new Map([
        ["es-to-primitive", "1.2.0"],
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
        ["has-symbols", "1.0.0"],
        ["is-callable", "1.1.4"],
        ["is-regex", "1.0.4"],
        ["object-inspect", "1.6.0"],
        ["object-keys", "1.1.1"],
        ["string.prototype.trimleft", "2.1.0"],
        ["string.prototype.trimright", "2.1.0"],
        ["es-abstract", "1.14.2"],
      ]),
    }],
  ])],
  ["es-to-primitive", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-es-to-primitive-1.2.0-edf72478033456e8dda8ef09e00ad9650707f377/node_modules/es-to-primitive/"),
      packageDependencies: new Map([
        ["is-callable", "1.1.4"],
        ["is-date-object", "1.0.1"],
        ["is-symbol", "1.0.2"],
        ["es-to-primitive", "1.2.0"],
      ]),
    }],
  ])],
  ["is-callable", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-callable-1.1.4-1e1adf219e1eeb684d691f9d6a05ff0d30a24d75/node_modules/is-callable/"),
      packageDependencies: new Map([
        ["is-callable", "1.1.4"],
      ]),
    }],
  ])],
  ["is-date-object", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-date-object-1.0.1-9aa20eb6aeebbff77fbd33e74ca01b33581d3a16/node_modules/is-date-object/"),
      packageDependencies: new Map([
        ["is-date-object", "1.0.1"],
      ]),
    }],
  ])],
  ["is-symbol", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-symbol-1.0.2-a055f6ae57192caee329e7a860118b497a950f38/node_modules/is-symbol/"),
      packageDependencies: new Map([
        ["has-symbols", "1.0.0"],
        ["is-symbol", "1.0.2"],
      ]),
    }],
  ])],
  ["has-symbols", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-symbols-1.0.0-ba1a8f1af2a0fc39650f5c850367704122063b44/node_modules/has-symbols/"),
      packageDependencies: new Map([
        ["has-symbols", "1.0.0"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
      ]),
    }],
  ])],
  ["has", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
      ]),
    }],
  ])],
  ["is-regex", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-regex-1.0.4-5517489b547091b0930e095654ced25ee97e9491/node_modules/is-regex/"),
      packageDependencies: new Map([
        ["has", "1.0.3"],
        ["is-regex", "1.0.4"],
      ]),
    }],
  ])],
  ["object-inspect", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-inspect-1.6.0-c70b6cbf72f274aab4c34c0c82f5167bf82cf15b/node_modules/object-inspect/"),
      packageDependencies: new Map([
        ["object-inspect", "1.6.0"],
      ]),
    }],
  ])],
  ["string.prototype.trimleft", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-prototype-trimleft-2.1.0-6cc47f0d7eb8d62b0f3701611715a3954591d634/node_modules/string.prototype.trimleft/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["function-bind", "1.1.1"],
        ["string.prototype.trimleft", "2.1.0"],
      ]),
    }],
  ])],
  ["string.prototype.trimright", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-prototype-trimright-2.1.0-669d164be9df9b6f7559fa8e89945b168a5a6c58/node_modules/string.prototype.trimright/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["function-bind", "1.1.1"],
        ["string.prototype.trimright", "2.1.0"],
      ]),
    }],
  ])],
  ["contains-path", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-contains-path-0.1.0-fe8cf184ff6670b6baef01a9d4861a5cbec4120a/node_modules/contains-path/"),
      packageDependencies: new Map([
        ["contains-path", "0.1.0"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["eslint-import-resolver-node", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-import-resolver-node-0.3.2-58f15fb839b8d0576ca980413476aab2472db66a/node_modules/eslint-import-resolver-node/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["resolve", "1.12.0"],
        ["eslint-import-resolver-node", "0.3.2"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.12.0"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["eslint-module-utils", new Map([
    ["2.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-module-utils-2.4.1-7b4675875bf96b0dbf1b21977456e5bb1f5e018c/node_modules/eslint-module-utils/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["pkg-dir", "2.0.0"],
        ["eslint-module-utils", "2.4.1"],
      ]),
    }],
  ])],
  ["object.values", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-values-1.1.0-bf6810ef5da3e5325790eaaa2be213ea84624da9/node_modules/object.values/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.14.2"],
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
        ["object.values", "1.1.0"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-up-2.0.0-6b72a8048984e0c41e79510fd5e9fa99b3b549be/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["read-pkg", "2.0.0"],
        ["read-pkg-up", "2.0.0"],
      ]),
    }],
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-up-6.0.0-da75ce72762f2fa1f20c5a40d4dd80c77db969e3/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["read-pkg", "5.2.0"],
        ["type-fest", "0.5.2"],
        ["read-pkg-up", "6.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-up-3.0.0-3ed496685dba0f8fe118d0691dc51f4a1ff96f07/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["read-pkg", "3.0.0"],
        ["read-pkg-up", "3.0.0"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-2.0.0-8ef1c0623c6a6db0dc6713c4bfac46332b2368f8/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "2.0.0"],
        ["normalize-package-data", "2.5.0"],
        ["path-type", "2.0.0"],
        ["read-pkg", "2.0.0"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-5.2.0-7bf295438ca5a33e56cd30e053b34ee7250c93cc/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["@types/normalize-package-data", "2.4.0"],
        ["normalize-package-data", "2.5.0"],
        ["parse-json", "5.0.0"],
        ["type-fest", "0.6.0"],
        ["read-pkg", "5.2.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-3.0.0-9cbc686978fee65d16c00e2b19c237fcf6e38389/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "4.0.0"],
        ["normalize-package-data", "2.5.0"],
        ["path-type", "3.0.0"],
        ["read-pkg", "3.0.0"],
      ]),
    }],
  ])],
  ["load-json-file", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-load-json-file-2.0.0-7947e42149af80d696cbf797bcaabcfe1fe29ca8/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["parse-json", "2.2.0"],
        ["pify", "2.3.0"],
        ["strip-bom", "3.0.0"],
        ["load-json-file", "2.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-load-json-file-4.0.0-2f5f45ab91e33216234fd53adab668eb4ec0993b/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["parse-json", "4.0.0"],
        ["pify", "3.0.0"],
        ["strip-bom", "3.0.0"],
        ["load-json-file", "4.0.0"],
      ]),
    }],
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-load-json-file-5.3.0-4d3c1e01fa1c03ea78a60ac7af932c9ce53403f3/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["parse-json", "4.0.0"],
        ["pify", "4.0.1"],
        ["strip-bom", "3.0.0"],
        ["type-fest", "0.3.1"],
        ["load-json-file", "5.3.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["parse-json", "2.2.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-json-5.0.0-73e5114c986d143efa3712d4ea24db9a4266f60f/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.5.5"],
        ["error-ex", "1.3.2"],
        ["json-parse-better-errors", "1.0.2"],
        ["lines-and-columns", "1.1.6"],
        ["parse-json", "5.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-json-4.0.0-be35f5425be1f7f6c747184f98a788cb99477ee0/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["json-parse-better-errors", "1.0.2"],
        ["parse-json", "4.0.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["pify", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pify-3.0.0-e5a4acd2c101fdf3d9a4d07f0dbc4db49dd28176/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "3.0.0"],
      ]),
    }],
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pify-4.0.1-4b2cd25c50d598735c50292224fd8c6df41e3231/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "4.0.1"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["strip-bom", "3.0.0"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
        ["resolve", "1.12.0"],
        ["semver", "5.7.1"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.5.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.8.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.0"],
        ["spdx-expression-parse", "3.0.0"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-correct", "3.1.0"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-expression-parse", "3.0.0"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.5"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-type-2.0.0-f012ccb8415b7096fc2daa1054c3d72389594c73/node_modules/path-type/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
        ["path-type", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-type-3.0.0-cef31dc8e0a1a3bb0d105c0cd97cf3bf47f4e36f/node_modules/path-type/"),
      packageDependencies: new Map([
        ["pify", "3.0.0"],
        ["path-type", "3.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-no-use-extend-native", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-no-use-extend-native-0.4.1-b2a631219b6a2e91b4370ef6559a754356560a40/node_modules/eslint-plugin-no-use-extend-native/"),
      packageDependencies: new Map([
        ["is-get-set-prop", "1.0.0"],
        ["is-js-type", "2.0.0"],
        ["is-obj-prop", "1.0.0"],
        ["is-proto-prop", "2.0.0"],
        ["eslint-plugin-no-use-extend-native", "0.4.1"],
      ]),
    }],
  ])],
  ["is-get-set-prop", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-get-set-prop-1.0.0-2731877e4d78a6a69edcce6bb9d68b0779e76312/node_modules/is-get-set-prop/"),
      packageDependencies: new Map([
        ["get-set-props", "0.1.0"],
        ["lowercase-keys", "1.0.1"],
        ["is-get-set-prop", "1.0.0"],
      ]),
    }],
  ])],
  ["get-set-props", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-set-props-0.1.0-998475c178445686d0b32246da5df8dbcfbe8ea3/node_modules/get-set-props/"),
      packageDependencies: new Map([
        ["get-set-props", "0.1.0"],
      ]),
    }],
  ])],
  ["lowercase-keys", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lowercase-keys-1.0.1-6f9e30b47084d971a7c820ff15a6c5167b74c26f/node_modules/lowercase-keys/"),
      packageDependencies: new Map([
        ["lowercase-keys", "1.0.1"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lowercase-keys-2.0.0-2603e78b7b4b0006cbca2fbcc8a3202558ac9479/node_modules/lowercase-keys/"),
      packageDependencies: new Map([
        ["lowercase-keys", "2.0.0"],
      ]),
    }],
  ])],
  ["is-js-type", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-js-type-2.0.0-73617006d659b4eb4729bba747d28782df0f7e22/node_modules/is-js-type/"),
      packageDependencies: new Map([
        ["js-types", "1.0.0"],
        ["is-js-type", "2.0.0"],
      ]),
    }],
  ])],
  ["js-types", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-js-types-1.0.0-d242e6494ed572ad3c92809fc8bed7f7687cbf03/node_modules/js-types/"),
      packageDependencies: new Map([
        ["js-types", "1.0.0"],
      ]),
    }],
  ])],
  ["is-obj-prop", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-obj-prop-1.0.0-b34de79c450b8d7c73ab2cdf67dc875adb85f80e/node_modules/is-obj-prop/"),
      packageDependencies: new Map([
        ["lowercase-keys", "1.0.1"],
        ["obj-props", "1.2.0"],
        ["is-obj-prop", "1.0.0"],
      ]),
    }],
  ])],
  ["obj-props", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-obj-props-1.2.0-3dbaa849f30238d84206c8b7192e1ce54d0d43b2/node_modules/obj-props/"),
      packageDependencies: new Map([
        ["obj-props", "1.2.0"],
      ]),
    }],
  ])],
  ["is-proto-prop", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-proto-prop-2.0.0-99ab2863462e44090fd083efd1929058f9d935e1/node_modules/is-proto-prop/"),
      packageDependencies: new Map([
        ["lowercase-keys", "1.0.1"],
        ["proto-props", "2.0.0"],
        ["is-proto-prop", "2.0.0"],
      ]),
    }],
  ])],
  ["proto-props", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-proto-props-2.0.0-8ac6e6dec658545815c623a3bc81580deda9a181/node_modules/proto-props/"),
      packageDependencies: new Map([
        ["proto-props", "2.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-node", new Map([
    ["10.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-node-10.0.0-fd1adbc7a300cf7eb6ac55cf4b0b6fc6e577f5a6/node_modules/eslint-plugin-node/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["eslint-plugin-es", "2.0.0"],
        ["eslint-utils", "1.4.2"],
        ["ignore", "5.1.4"],
        ["minimatch", "3.0.4"],
        ["resolve", "1.12.0"],
        ["semver", "6.3.0"],
        ["eslint-plugin-node", "10.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-es", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-es-2.0.0-0f5f5da5f18aa21989feebe8a73eadefb3432976/node_modules/eslint-plugin-es/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["eslint-utils", "1.4.2"],
        ["regexpp", "3.0.0"],
        ["eslint-plugin-es", "2.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-prettier", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-prettier-3.1.1-507b8562410d02a03f0ddc949c616f877852f2ba/node_modules/eslint-plugin-prettier/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["prettier", "1.18.2"],
        ["prettier-linter-helpers", "1.0.0"],
        ["eslint-plugin-prettier", "3.1.1"],
      ]),
    }],
  ])],
  ["prettier-linter-helpers", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-prettier-linter-helpers-1.0.0-d23d41fe1375646de2d0104d3454a3008802cf7b/node_modules/prettier-linter-helpers/"),
      packageDependencies: new Map([
        ["fast-diff", "1.2.0"],
        ["prettier-linter-helpers", "1.0.0"],
      ]),
    }],
  ])],
  ["fast-diff", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-diff-1.2.0-73ee11982d86caaf7959828d519cfe927fac5f03/node_modules/fast-diff/"),
      packageDependencies: new Map([
        ["fast-diff", "1.2.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-promise", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-promise-4.2.1-845fd8b2260ad8f82564c1222fce44ad71d9418a/node_modules/eslint-plugin-promise/"),
      packageDependencies: new Map([
        ["eslint-plugin-promise", "4.2.1"],
      ]),
    }],
  ])],
  ["eslint-plugin-unicorn", new Map([
    ["12.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-plugin-unicorn-12.0.1-f902c3c80dbc027fb3bd4665713c3dcb1954bc6a/node_modules/eslint-plugin-unicorn/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["ci-info", "2.0.0"],
        ["clean-regexp", "1.0.0"],
        ["eslint-ast-utils", "1.1.0"],
        ["eslint-template-visitor", "1.1.0"],
        ["import-modules", "1.1.0"],
        ["lodash.camelcase", "4.3.0"],
        ["lodash.defaultsdeep", "4.6.1"],
        ["lodash.kebabcase", "4.1.1"],
        ["lodash.snakecase", "4.1.1"],
        ["lodash.topairs", "4.3.0"],
        ["lodash.upperfirst", "4.3.1"],
        ["read-pkg-up", "6.0.0"],
        ["regexpp", "3.0.0"],
        ["reserved-words", "0.1.2"],
        ["safe-regex", "2.0.2"],
        ["semver", "6.3.0"],
        ["eslint-plugin-unicorn", "12.0.1"],
      ]),
    }],
  ])],
  ["ci-info", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ci-info-2.0.0-67a9e964be31a51e15e5010d58e6f12834002f46/node_modules/ci-info/"),
      packageDependencies: new Map([
        ["ci-info", "2.0.0"],
      ]),
    }],
  ])],
  ["clean-regexp", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-clean-regexp-1.0.0-8df7c7aae51fd36874e8f8d05b9180bc11a3fed7/node_modules/clean-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["clean-regexp", "1.0.0"],
      ]),
    }],
  ])],
  ["eslint-ast-utils", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-ast-utils-1.1.0-3d58ba557801cfb1c941d68131ee9f8c34bd1586/node_modules/eslint-ast-utils/"),
      packageDependencies: new Map([
        ["lodash.get", "4.4.2"],
        ["lodash.zip", "4.2.0"],
        ["eslint-ast-utils", "1.1.0"],
      ]),
    }],
  ])],
  ["lodash.get", new Map([
    ["4.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-get-4.4.2-2d177f652fa31e939b4438d5341499dfa3825e99/node_modules/lodash.get/"),
      packageDependencies: new Map([
        ["lodash.get", "4.4.2"],
      ]),
    }],
  ])],
  ["lodash.zip", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-zip-4.2.0-ec6662e4896408ed4ab6c542a3990b72cc080020/node_modules/lodash.zip/"),
      packageDependencies: new Map([
        ["lodash.zip", "4.2.0"],
      ]),
    }],
  ])],
  ["eslint-template-visitor", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-eslint-template-visitor-1.1.0-f090d124d1a52e05552149fc50468ed59608b166/node_modules/eslint-template-visitor/"),
      packageDependencies: new Map([
        ["eslint", "6.4.0"],
        ["eslint-visitor-keys", "1.1.0"],
        ["espree", "6.1.1"],
        ["multimap", "1.0.2"],
        ["eslint-template-visitor", "1.1.0"],
      ]),
    }],
  ])],
  ["multimap", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-multimap-1.0.2-6aa76fc3233905ba948bbe4c74dc2c3a0356eb36/node_modules/multimap/"),
      packageDependencies: new Map([
        ["multimap", "1.0.2"],
      ]),
    }],
  ])],
  ["lodash.camelcase", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-camelcase-4.3.0-b28aa6288a2b9fc651035c7711f65ab6190331a6/node_modules/lodash.camelcase/"),
      packageDependencies: new Map([
        ["lodash.camelcase", "4.3.0"],
      ]),
    }],
  ])],
  ["lodash.defaultsdeep", new Map([
    ["4.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-defaultsdeep-4.6.1-512e9bd721d272d94e3d3a63653fa17516741ca6/node_modules/lodash.defaultsdeep/"),
      packageDependencies: new Map([
        ["lodash.defaultsdeep", "4.6.1"],
      ]),
    }],
  ])],
  ["lodash.kebabcase", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-kebabcase-4.1.1-8489b1cb0d29ff88195cceca448ff6d6cc295c36/node_modules/lodash.kebabcase/"),
      packageDependencies: new Map([
        ["lodash.kebabcase", "4.1.1"],
      ]),
    }],
  ])],
  ["lodash.snakecase", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-snakecase-4.1.1-39d714a35357147837aefd64b5dcbb16becd8f8d/node_modules/lodash.snakecase/"),
      packageDependencies: new Map([
        ["lodash.snakecase", "4.1.1"],
      ]),
    }],
  ])],
  ["lodash.topairs", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-topairs-4.3.0-3b6deaa37d60fb116713c46c5f17ea190ec48d64/node_modules/lodash.topairs/"),
      packageDependencies: new Map([
        ["lodash.topairs", "4.3.0"],
      ]),
    }],
  ])],
  ["lodash.upperfirst", new Map([
    ["4.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-upperfirst-4.3.1-1365edf431480481ef0d1c68957a5ed99d49f7ce/node_modules/lodash.upperfirst/"),
      packageDependencies: new Map([
        ["lodash.upperfirst", "4.3.1"],
      ]),
    }],
  ])],
  ["@types/normalize-package-data", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@types-normalize-package-data-2.4.0-e486d0d97396d79beedd0a6e33f4534ff6b4973e/node_modules/@types/normalize-package-data/"),
      packageDependencies: new Map([
        ["@types/normalize-package-data", "2.4.0"],
      ]),
    }],
  ])],
  ["json-parse-better-errors", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-parse-better-errors-1.0.2-bb867cfb3450e69107c131d1c514bab3dc8bcaa9/node_modules/json-parse-better-errors/"),
      packageDependencies: new Map([
        ["json-parse-better-errors", "1.0.2"],
      ]),
    }],
  ])],
  ["lines-and-columns", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lines-and-columns-1.1.6-1c00c743b433cd0a4e80758f7b64a57440d9ff00/node_modules/lines-and-columns/"),
      packageDependencies: new Map([
        ["lines-and-columns", "1.1.6"],
      ]),
    }],
  ])],
  ["reserved-words", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-reserved-words-0.1.2-00a0940f98cd501aeaaac316411d9adc52b31ab1/node_modules/reserved-words/"),
      packageDependencies: new Map([
        ["reserved-words", "0.1.2"],
      ]),
    }],
  ])],
  ["safe-regex", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-regex-2.0.2-3601b28d3aefe4b963d42f6c2cdb241265cbd63c/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["regexp-tree", "0.1.14"],
        ["safe-regex", "2.0.2"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
        ["safe-regex", "1.1.0"],
      ]),
    }],
  ])],
  ["regexp-tree", new Map([
    ["0.1.14", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regexp-tree-0.1.14-1abca3675f6cc4b0dee5c959c6c4554ed172dfae/node_modules/regexp-tree/"),
      packageDependencies: new Map([
        ["regexp-tree", "0.1.14"],
      ]),
    }],
  ])],
  ["find-cache-dir", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-cache-dir-3.0.0-cd4b7dd97b7185b7e17dbfe2d6e4115ee3eeb8fc/node_modules/find-cache-dir/"),
      packageDependencies: new Map([
        ["commondir", "1.0.1"],
        ["make-dir", "3.0.0"],
        ["pkg-dir", "4.2.0"],
        ["find-cache-dir", "3.0.0"],
      ]),
    }],
  ])],
  ["commondir", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-commondir-1.0.1-ddd800da0c66127393cca5950ea968a3aaf1253b/node_modules/commondir/"),
      packageDependencies: new Map([
        ["commondir", "1.0.1"],
      ]),
    }],
  ])],
  ["make-dir", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-make-dir-3.0.0-1b5f39f6b9270ed33f9f054c5c0f84304989f801/node_modules/make-dir/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
        ["make-dir", "3.0.0"],
      ]),
    }],
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-make-dir-1.3.0-79c1033b80515bd6d24ec9933e860ca75ee27f0c/node_modules/make-dir/"),
      packageDependencies: new Map([
        ["pify", "3.0.0"],
        ["make-dir", "1.3.0"],
      ]),
    }],
  ])],
  ["globby", new Map([
    ["9.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-globby-9.2.0-fd029a706c703d29bdd170f4b6db3a3f7a7cb63d/node_modules/globby/"),
      packageDependencies: new Map([
        ["@types/glob", "7.1.1"],
        ["array-union", "1.0.2"],
        ["dir-glob", "2.2.2"],
        ["fast-glob", "2.2.7"],
        ["glob", "7.1.4"],
        ["ignore", "4.0.6"],
        ["pify", "4.0.1"],
        ["slash", "2.0.0"],
        ["globby", "9.2.0"],
      ]),
    }],
  ])],
  ["@types/glob", new Map([
    ["7.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@types-glob-7.1.1-aa59a1c6e3fbc421e07ccd31a944c30eba521575/node_modules/@types/glob/"),
      packageDependencies: new Map([
        ["@types/events", "3.0.0"],
        ["@types/minimatch", "3.0.3"],
        ["@types/node", "12.7.8"],
        ["@types/glob", "7.1.1"],
      ]),
    }],
  ])],
  ["@types/events", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@types-events-3.0.0-2862f3f58a9a7f7c3e78d79f130dd4d71c25c2a7/node_modules/@types/events/"),
      packageDependencies: new Map([
        ["@types/events", "3.0.0"],
      ]),
    }],
  ])],
  ["@types/minimatch", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@types-minimatch-3.0.3-3dca0e3f33b200fc7d1139c0cd96c1268cadfd9d/node_modules/@types/minimatch/"),
      packageDependencies: new Map([
        ["@types/minimatch", "3.0.3"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["12.7.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@types-node-12.7.8-cb1bf6800238898bc2ff6ffa5702c3cadd350708/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["@types/node", "12.7.8"],
      ]),
    }],
  ])],
  ["array-union", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-union-1.0.2-9a34410e4f4e3da23dea375be5be70f24778ec39/node_modules/array-union/"),
      packageDependencies: new Map([
        ["array-uniq", "1.0.3"],
        ["array-union", "1.0.2"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-union-2.1.0-b798420adbeb1de828d84acd8a2e23d3efe85e8d/node_modules/array-union/"),
      packageDependencies: new Map([
        ["array-union", "2.1.0"],
      ]),
    }],
  ])],
  ["array-uniq", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-uniq-1.0.3-af6ac877a25cc7f74e058894753858dfdb24fdb6/node_modules/array-uniq/"),
      packageDependencies: new Map([
        ["array-uniq", "1.0.3"],
      ]),
    }],
  ])],
  ["dir-glob", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-dir-glob-2.2.2-fa09f0694153c8918b18ba0deafae94769fc50c4/node_modules/dir-glob/"),
      packageDependencies: new Map([
        ["path-type", "3.0.0"],
        ["dir-glob", "2.2.2"],
      ]),
    }],
  ])],
  ["fast-glob", new Map([
    ["2.2.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-glob-2.2.7-6953857c3afa475fff92ee6015d52da70a4cd39d/node_modules/fast-glob/"),
      packageDependencies: new Map([
        ["@mrmlnc/readdir-enhanced", "2.2.1"],
        ["@nodelib/fs.stat", "1.1.3"],
        ["glob-parent", "3.1.0"],
        ["is-glob", "4.0.1"],
        ["merge2", "1.3.0"],
        ["micromatch", "3.1.10"],
        ["fast-glob", "2.2.7"],
      ]),
    }],
  ])],
  ["@mrmlnc/readdir-enhanced", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@mrmlnc-readdir-enhanced-2.2.1-524af240d1a360527b730475ecfa1344aa540dde/node_modules/@mrmlnc/readdir-enhanced/"),
      packageDependencies: new Map([
        ["call-me-maybe", "1.0.1"],
        ["glob-to-regexp", "0.3.0"],
        ["@mrmlnc/readdir-enhanced", "2.2.1"],
      ]),
    }],
  ])],
  ["call-me-maybe", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-call-me-maybe-1.0.1-26d208ea89e37b5cbde60250a15f031c16a4d66b/node_modules/call-me-maybe/"),
      packageDependencies: new Map([
        ["call-me-maybe", "1.0.1"],
      ]),
    }],
  ])],
  ["glob-to-regexp", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-to-regexp-0.3.0-8c5a1494d2066c570cc3bfe4496175acc4d502ab/node_modules/glob-to-regexp/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.3.0"],
      ]),
    }],
  ])],
  ["@nodelib/fs.stat", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@nodelib-fs-stat-1.1.3-2b5a3ab3f918cca48a8c754c08168e3f03eba61b/node_modules/@nodelib/fs.stat/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "1.1.3"],
      ]),
    }],
  ])],
  ["path-dirname", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/"),
      packageDependencies: new Map([
        ["path-dirname", "1.0.2"],
      ]),
    }],
  ])],
  ["merge2", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-merge2-1.3.0-5b366ee83b2f1582c48f87e47cf1a9352103ca81/node_modules/merge2/"),
      packageDependencies: new Map([
        ["merge2", "1.3.0"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["3.1.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["braces", "2.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["extglob", "2.0.4"],
        ["fragment-cache", "0.2.1"],
        ["kind-of", "6.0.2"],
        ["nanomatch", "1.2.13"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["micromatch", "3.1.10"],
      ]),
    }],
  ])],
  ["arr-diff", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
      ]),
    }],
  ])],
  ["array-unique", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["2.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["array-unique", "0.3.2"],
        ["extend-shallow", "2.0.1"],
        ["fill-range", "4.0.0"],
        ["isobject", "3.0.1"],
        ["repeat-element", "1.1.3"],
        ["snapdragon", "0.8.2"],
        ["snapdragon-node", "2.1.1"],
        ["split-string", "3.1.0"],
        ["to-regex", "3.0.2"],
        ["braces", "2.3.2"],
      ]),
    }],
  ])],
  ["arr-flatten", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
      ]),
    }],
  ])],
  ["extend-shallow", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
        ["extend-shallow", "2.0.1"],
      ]),
    }],
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
        ["is-extendable", "1.0.1"],
        ["extend-shallow", "3.0.2"],
      ]),
    }],
  ])],
  ["is-extendable", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["is-extendable", "1.0.1"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
        ["fill-range", "4.0.0"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "3.0.0"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "4.0.0"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "5.1.0"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
        ["isobject", "2.1.0"],
      ]),
    }],
  ])],
  ["repeat-element", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/"),
      packageDependencies: new Map([
        ["repeat-element", "1.1.3"],
      ]),
    }],
  ])],
  ["snapdragon", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/"),
      packageDependencies: new Map([
        ["base", "0.11.2"],
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["map-cache", "0.2.2"],
        ["source-map", "0.5.7"],
        ["source-map-resolve", "0.5.2"],
        ["use", "3.1.1"],
        ["snapdragon", "0.8.2"],
      ]),
    }],
  ])],
  ["base", new Map([
    ["0.11.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/"),
      packageDependencies: new Map([
        ["cache-base", "1.0.1"],
        ["class-utils", "0.3.6"],
        ["component-emitter", "1.3.0"],
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["mixin-deep", "1.3.2"],
        ["pascalcase", "0.1.1"],
        ["base", "0.11.2"],
      ]),
    }],
  ])],
  ["cache-base", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/"),
      packageDependencies: new Map([
        ["collection-visit", "1.0.0"],
        ["component-emitter", "1.3.0"],
        ["get-value", "2.0.6"],
        ["has-value", "1.0.0"],
        ["isobject", "3.0.1"],
        ["set-value", "2.0.1"],
        ["to-object-path", "0.3.0"],
        ["union-value", "1.0.1"],
        ["unset-value", "1.0.0"],
        ["cache-base", "1.0.1"],
      ]),
    }],
  ])],
  ["collection-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/"),
      packageDependencies: new Map([
        ["map-visit", "1.0.0"],
        ["object-visit", "1.0.1"],
        ["collection-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["map-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/"),
      packageDependencies: new Map([
        ["object-visit", "1.0.1"],
        ["map-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["object-visit", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object-visit", "1.0.1"],
      ]),
    }],
  ])],
  ["component-emitter", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/"),
      packageDependencies: new Map([
        ["component-emitter", "1.3.0"],
      ]),
    }],
  ])],
  ["get-value", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
      ]),
    }],
  ])],
  ["has-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "1.0.0"],
        ["isobject", "3.0.1"],
        ["has-value", "1.0.0"],
      ]),
    }],
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "0.1.4"],
        ["isobject", "2.1.0"],
        ["has-value", "0.3.1"],
      ]),
    }],
  ])],
  ["has-values", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["kind-of", "4.0.0"],
        ["has-values", "1.0.0"],
      ]),
    }],
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/"),
      packageDependencies: new Map([
        ["has-values", "0.1.4"],
      ]),
    }],
  ])],
  ["set-value", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-extendable", "0.1.1"],
        ["is-plain-object", "2.0.4"],
        ["split-string", "3.1.0"],
        ["set-value", "2.0.1"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["split-string", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["split-string", "3.1.0"],
      ]),
    }],
  ])],
  ["assign-symbols", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
      ]),
    }],
  ])],
  ["to-object-path", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["to-object-path", "0.3.0"],
      ]),
    }],
  ])],
  ["union-value", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["get-value", "2.0.6"],
        ["is-extendable", "0.1.1"],
        ["set-value", "2.0.1"],
        ["union-value", "1.0.1"],
      ]),
    }],
  ])],
  ["arr-union", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
      ]),
    }],
  ])],
  ["unset-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/"),
      packageDependencies: new Map([
        ["has-value", "0.3.1"],
        ["isobject", "3.0.1"],
        ["unset-value", "1.0.0"],
      ]),
    }],
  ])],
  ["class-utils", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["define-property", "0.2.5"],
        ["isobject", "3.0.1"],
        ["static-extend", "0.1.2"],
        ["class-utils", "0.3.6"],
      ]),
    }],
  ])],
  ["define-property", new Map([
    ["0.2.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "0.1.6"],
        ["define-property", "0.2.5"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["define-property", "1.0.0"],
      ]),
    }],
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["isobject", "3.0.1"],
        ["define-property", "2.0.2"],
      ]),
    }],
  ])],
  ["is-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "0.1.6"],
        ["is-data-descriptor", "0.1.4"],
        ["kind-of", "5.1.0"],
        ["is-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "1.0.0"],
        ["is-data-descriptor", "1.0.0"],
        ["kind-of", "6.0.2"],
        ["is-descriptor", "1.0.2"],
      ]),
    }],
  ])],
  ["is-accessor-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-accessor-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-accessor-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["is-data-descriptor", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-data-descriptor", "0.1.4"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-data-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["static-extend", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/"),
      packageDependencies: new Map([
        ["define-property", "0.2.5"],
        ["object-copy", "0.1.0"],
        ["static-extend", "0.1.2"],
      ]),
    }],
  ])],
  ["object-copy", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
        ["define-property", "0.2.5"],
        ["kind-of", "3.2.2"],
        ["object-copy", "0.1.0"],
      ]),
    }],
  ])],
  ["copy-descriptor", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
      ]),
    }],
  ])],
  ["mixin-deep", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["is-extendable", "1.0.1"],
        ["mixin-deep", "1.3.2"],
      ]),
    }],
  ])],
  ["for-in", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
      ]),
    }],
  ])],
  ["pascalcase", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/"),
      packageDependencies: new Map([
        ["pascalcase", "0.1.1"],
      ]),
    }],
  ])],
  ["map-cache", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
  ])],
  ["source-map-resolve", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
        ["decode-uri-component", "0.2.0"],
        ["resolve-url", "0.2.1"],
        ["source-map-url", "0.4.0"],
        ["urix", "0.1.0"],
        ["source-map-resolve", "0.5.2"],
      ]),
    }],
  ])],
  ["atob", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
      ]),
    }],
  ])],
  ["decode-uri-component", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/"),
      packageDependencies: new Map([
        ["decode-uri-component", "0.2.0"],
      ]),
    }],
  ])],
  ["resolve-url", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/"),
      packageDependencies: new Map([
        ["resolve-url", "0.2.1"],
      ]),
    }],
  ])],
  ["source-map-url", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/"),
      packageDependencies: new Map([
        ["source-map-url", "0.4.0"],
      ]),
    }],
  ])],
  ["urix", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/"),
      packageDependencies: new Map([
        ["urix", "0.1.0"],
      ]),
    }],
  ])],
  ["use", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/"),
      packageDependencies: new Map([
        ["use", "3.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-node", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/"),
      packageDependencies: new Map([
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["snapdragon-util", "3.0.1"],
        ["snapdragon-node", "2.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-util", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["snapdragon-util", "3.0.1"],
      ]),
    }],
  ])],
  ["to-regex", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/"),
      packageDependencies: new Map([
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["regex-not", "1.0.2"],
        ["safe-regex", "1.1.0"],
        ["to-regex", "3.0.2"],
      ]),
    }],
  ])],
  ["regex-not", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["safe-regex", "1.1.0"],
        ["regex-not", "1.0.2"],
      ]),
    }],
  ])],
  ["ret", new Map([
    ["0.1.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
      ]),
    }],
  ])],
  ["extglob", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
        ["define-property", "1.0.0"],
        ["expand-brackets", "2.1.4"],
        ["extend-shallow", "2.0.1"],
        ["fragment-cache", "0.2.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["extglob", "2.0.4"],
      ]),
    }],
  ])],
  ["expand-brackets", new Map([
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["posix-character-classes", "0.1.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["expand-brackets", "2.1.4"],
      ]),
    }],
  ])],
  ["posix-character-classes", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/"),
      packageDependencies: new Map([
        ["posix-character-classes", "0.1.1"],
      ]),
    }],
  ])],
  ["fragment-cache", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
        ["fragment-cache", "0.2.1"],
      ]),
    }],
  ])],
  ["nanomatch", new Map([
    ["1.2.13", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["fragment-cache", "0.2.1"],
        ["is-windows", "1.0.2"],
        ["kind-of", "6.0.2"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["nanomatch", "1.2.13"],
      ]),
    }],
  ])],
  ["is-windows", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/"),
      packageDependencies: new Map([
        ["is-windows", "1.0.2"],
      ]),
    }],
  ])],
  ["object.pick", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object.pick", "1.3.0"],
      ]),
    }],
  ])],
  ["slash", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-slash-2.0.0-de552851a1759df3a8f206535442f5ec4ddeab44/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "3.0.0"],
      ]),
    }],
  ])],
  ["lodash.isequal", new Map([
    ["4.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-isequal-4.5.0-415c4478f2bcc30120c22ce10ed3226f7d3e18e0/node_modules/lodash.isequal/"),
      packageDependencies: new Map([
        ["lodash.isequal", "4.5.0"],
      ]),
    }],
  ])],
  ["lodash.mergewith", new Map([
    ["4.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-mergewith-4.6.2-617121f89ac55f59047c7aec1ccd6654c6590f55/node_modules/lodash.mergewith/"),
      packageDependencies: new Map([
        ["lodash.mergewith", "4.6.2"],
      ]),
    }],
  ])],
  ["meow", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-meow-5.0.0-dfc73d63a9afc714a5e371760eb5c88b91078aa4/node_modules/meow/"),
      packageDependencies: new Map([
        ["camelcase-keys", "4.2.0"],
        ["decamelize-keys", "1.1.0"],
        ["loud-rejection", "1.6.0"],
        ["minimist-options", "3.0.2"],
        ["normalize-package-data", "2.5.0"],
        ["read-pkg-up", "3.0.0"],
        ["redent", "2.0.0"],
        ["trim-newlines", "2.0.0"],
        ["yargs-parser", "10.1.0"],
        ["meow", "5.0.0"],
      ]),
    }],
  ])],
  ["camelcase-keys", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-camelcase-keys-4.2.0-a2aa5fb1af688758259c32c141426d78923b9b77/node_modules/camelcase-keys/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
        ["map-obj", "2.0.0"],
        ["quick-lru", "1.1.0"],
        ["camelcase-keys", "4.2.0"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-camelcase-4.1.0-d545635be1e33c542649c69173e5de6acfae34dd/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
      ]),
    }],
    ["5.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-camelcase-5.3.1-e3c9b31569e106811df242f715725a1f4c494320/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "5.3.1"],
      ]),
    }],
  ])],
  ["map-obj", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-map-obj-2.0.0-a65cd29087a92598b8791257a523e021222ac1f9/node_modules/map-obj/"),
      packageDependencies: new Map([
        ["map-obj", "2.0.0"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-map-obj-1.0.1-d933ceb9205d82bdcf4886f6742bdc2b4dea146d/node_modules/map-obj/"),
      packageDependencies: new Map([
        ["map-obj", "1.0.1"],
      ]),
    }],
  ])],
  ["quick-lru", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-quick-lru-1.1.0-4360b17c61136ad38078397ff11416e186dcfbb8/node_modules/quick-lru/"),
      packageDependencies: new Map([
        ["quick-lru", "1.1.0"],
      ]),
    }],
  ])],
  ["decamelize-keys", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-decamelize-keys-1.1.0-d171a87933252807eb3cb61dc1c1445d078df2d9/node_modules/decamelize-keys/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
        ["map-obj", "1.0.1"],
        ["decamelize-keys", "1.1.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["loud-rejection", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-loud-rejection-1.6.0-5b46f80147edee578870f086d04821cf998e551f/node_modules/loud-rejection/"),
      packageDependencies: new Map([
        ["currently-unhandled", "0.4.1"],
        ["signal-exit", "3.0.2"],
        ["loud-rejection", "1.6.0"],
      ]),
    }],
  ])],
  ["currently-unhandled", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-currently-unhandled-0.4.1-988df33feab191ef799a61369dd76c17adf957ea/node_modules/currently-unhandled/"),
      packageDependencies: new Map([
        ["array-find-index", "1.0.2"],
        ["currently-unhandled", "0.4.1"],
      ]),
    }],
  ])],
  ["array-find-index", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-find-index-1.0.2-df010aa1287e164bbda6f9723b0a96a1ec4187a1/node_modules/array-find-index/"),
      packageDependencies: new Map([
        ["array-find-index", "1.0.2"],
      ]),
    }],
  ])],
  ["minimist-options", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-options-3.0.2-fba4c8191339e13ecf4d61beb03f070103f3d954/node_modules/minimist-options/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
        ["is-plain-obj", "1.1.0"],
        ["minimist-options", "3.0.2"],
      ]),
    }],
  ])],
  ["is-plain-obj", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-plain-obj-1.1.0-71a50c8429dfca773c92a390a4a03b39fcd51d3e/node_modules/is-plain-obj/"),
      packageDependencies: new Map([
        ["is-plain-obj", "1.1.0"],
      ]),
    }],
  ])],
  ["redent", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-redent-2.0.0-c1b2007b42d57eb1389079b3c8333639d5e1ccaa/node_modules/redent/"),
      packageDependencies: new Map([
        ["indent-string", "3.2.0"],
        ["strip-indent", "2.0.0"],
        ["redent", "2.0.0"],
      ]),
    }],
  ])],
  ["indent-string", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-indent-string-3.2.0-4a5fd6d27cc332f37e5419a504dbb837105c9289/node_modules/indent-string/"),
      packageDependencies: new Map([
        ["indent-string", "3.2.0"],
      ]),
    }],
  ])],
  ["strip-indent", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-indent-2.0.0-5ef8db295d01e6ed6cbf7aab96998d7822527b68/node_modules/strip-indent/"),
      packageDependencies: new Map([
        ["strip-indent", "2.0.0"],
      ]),
    }],
  ])],
  ["trim-newlines", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-trim-newlines-2.0.0-b403d0b91be50c331dfc4b82eeceb22c3de16d20/node_modules/trim-newlines/"),
      packageDependencies: new Map([
        ["trim-newlines", "2.0.0"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["10.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-yargs-parser-10.1.0-7202265b89f7e9e9f2e5765e0fe735a905edbaa8/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
        ["yargs-parser", "10.1.0"],
      ]),
    }],
  ])],
  ["multimatch", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-multimatch-4.0.0-8c3c0f6e3e8449ada0af3dd29efb491a375191b3/node_modules/multimatch/"),
      packageDependencies: new Map([
        ["@types/minimatch", "3.0.3"],
        ["array-differ", "3.0.0"],
        ["array-union", "2.1.0"],
        ["arrify", "2.0.1"],
        ["minimatch", "3.0.4"],
        ["multimatch", "4.0.0"],
      ]),
    }],
  ])],
  ["array-differ", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-differ-3.0.0-3cbb3d0f316810eafcc47624734237d6aee4ae6b/node_modules/array-differ/"),
      packageDependencies: new Map([
        ["array-differ", "3.0.0"],
      ]),
    }],
  ])],
  ["open-editor", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-open-editor-2.0.1-d001055770fbf6f6ee73c18f224915f444be863c/node_modules/open-editor/"),
      packageDependencies: new Map([
        ["env-editor", "0.4.1"],
        ["line-column-path", "2.0.0"],
        ["open", "6.4.0"],
        ["open-editor", "2.0.1"],
      ]),
    }],
  ])],
  ["env-editor", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-env-editor-0.4.1-77011e08ce45f46e404e8d996b465c684ca57502/node_modules/env-editor/"),
      packageDependencies: new Map([
        ["env-editor", "0.4.1"],
      ]),
    }],
  ])],
  ["line-column-path", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-line-column-path-2.0.0-439aff48ef80d74c475801a25b560d021acf1288/node_modules/line-column-path/"),
      packageDependencies: new Map([
        ["type-fest", "0.4.1"],
        ["line-column-path", "2.0.0"],
      ]),
    }],
  ])],
  ["open", new Map([
    ["6.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-open-6.4.0-5c13e96d0dc894686164f18965ecfe889ecfc8a9/node_modules/open/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
        ["open", "6.4.0"],
      ]),
    }],
  ])],
  ["is-wsl", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
      ]),
    }],
  ])],
  ["pkg-conf", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pkg-conf-3.1.0-d9f9c75ea1bae0e77938cde045b276dac7cc69ae/node_modules/pkg-conf/"),
      packageDependencies: new Map([
        ["find-up", "3.0.0"],
        ["load-json-file", "5.3.0"],
        ["pkg-conf", "3.1.0"],
      ]),
    }],
  ])],
  ["prettier", new Map([
    ["1.18.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-prettier-1.18.2-6823e7c5900017b4bd3acf46fe9ac4b4d7bda9ea/node_modules/prettier/"),
      packageDependencies: new Map([
        ["prettier", "1.18.2"],
      ]),
    }],
  ])],
  ["resolve-cwd", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d/node_modules/resolve-cwd/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
        ["resolve-cwd", "3.0.0"],
      ]),
    }],
  ])],
  ["update-notifier", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-update-notifier-3.0.1-78ecb68b915e2fd1be9f767f6e298ce87b736250/node_modules/update-notifier/"),
      packageDependencies: new Map([
        ["boxen", "3.2.0"],
        ["chalk", "2.4.2"],
        ["configstore", "4.0.0"],
        ["has-yarn", "2.1.0"],
        ["import-lazy", "2.1.0"],
        ["is-ci", "2.0.0"],
        ["is-installed-globally", "0.1.0"],
        ["is-npm", "3.0.0"],
        ["is-yarn-global", "0.3.0"],
        ["latest-version", "5.1.0"],
        ["semver-diff", "2.1.0"],
        ["xdg-basedir", "3.0.0"],
        ["update-notifier", "3.0.1"],
      ]),
    }],
  ])],
  ["boxen", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-boxen-3.2.0-fbdff0de93636ab4450886b6ff45b92d098f45eb/node_modules/boxen/"),
      packageDependencies: new Map([
        ["ansi-align", "3.0.0"],
        ["camelcase", "5.3.1"],
        ["chalk", "2.4.2"],
        ["cli-boxes", "2.2.0"],
        ["string-width", "3.1.0"],
        ["term-size", "1.2.0"],
        ["type-fest", "0.3.1"],
        ["widest-line", "2.0.1"],
        ["boxen", "3.2.0"],
      ]),
    }],
  ])],
  ["ansi-align", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-align-3.0.0-b536b371cf687caaef236c18d3e21fe3797467cb/node_modules/ansi-align/"),
      packageDependencies: new Map([
        ["string-width", "3.1.0"],
        ["ansi-align", "3.0.0"],
      ]),
    }],
  ])],
  ["cli-boxes", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-boxes-2.2.0-538ecae8f9c6ca508e3c3c95b453fe93cb4c168d/node_modules/cli-boxes/"),
      packageDependencies: new Map([
        ["cli-boxes", "2.2.0"],
      ]),
    }],
  ])],
  ["term-size", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-term-size-1.2.0-458b83887f288fc56d6fffbfad262e26638efa69/node_modules/term-size/"),
      packageDependencies: new Map([
        ["execa", "0.7.0"],
        ["term-size", "1.2.0"],
      ]),
    }],
  ])],
  ["execa", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-execa-0.7.0-944becd34cc41ee32a63a9faf27ad5a65fc59777/node_modules/execa/"),
      packageDependencies: new Map([
        ["cross-spawn", "5.1.0"],
        ["get-stream", "3.0.0"],
        ["is-stream", "1.1.0"],
        ["npm-run-path", "2.0.2"],
        ["p-finally", "1.0.0"],
        ["signal-exit", "3.0.2"],
        ["strip-eof", "1.0.0"],
        ["execa", "0.7.0"],
      ]),
    }],
    ["0.9.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-execa-0.9.0-adb7ce62cf985071f60580deb4a88b9e34712d01/node_modules/execa/"),
      packageDependencies: new Map([
        ["cross-spawn", "5.1.0"],
        ["get-stream", "3.0.0"],
        ["is-stream", "1.1.0"],
        ["npm-run-path", "2.0.2"],
        ["p-finally", "1.0.0"],
        ["signal-exit", "3.0.2"],
        ["strip-eof", "1.0.0"],
        ["execa", "0.9.0"],
      ]),
    }],
  ])],
  ["lru-cache", new Map([
    ["4.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lru-cache-4.1.5-8bbe50ea85bed59bc9e33dcab8235ee9bcf443cd/node_modules/lru-cache/"),
      packageDependencies: new Map([
        ["pseudomap", "1.0.2"],
        ["yallist", "2.1.2"],
        ["lru-cache", "4.1.5"],
      ]),
    }],
  ])],
  ["pseudomap", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pseudomap-1.0.2-f052a28da70e618917ef0a8ac34c1ae5a68286b3/node_modules/pseudomap/"),
      packageDependencies: new Map([
        ["pseudomap", "1.0.2"],
      ]),
    }],
  ])],
  ["yallist", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-yallist-2.1.2-1c11f9218f076089a47dd512f93c6699a6a81d52/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "2.1.2"],
      ]),
    }],
  ])],
  ["get-stream", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-stream-3.0.0-8e943d1358dc37555054ecbe2edb05aa174ede14/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["get-stream", "3.0.0"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-stream-5.1.0-01203cdc92597f9b909067c3e656cc1f4d3c4dc9/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["pump", "3.0.0"],
        ["get-stream", "5.1.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-stream-4.1.0-c1b255575f3dc21d59bfc79cd3d2b46b1c3a54b5/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["pump", "3.0.0"],
        ["get-stream", "4.1.0"],
      ]),
    }],
  ])],
  ["npm-run-path", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-npm-run-path-2.0.2-35a9232dfa35d7067b4cb2ddf2357b1871536c5f/node_modules/npm-run-path/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
        ["npm-run-path", "2.0.2"],
      ]),
    }],
  ])],
  ["p-finally", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-finally-1.0.0-3fbcfb15b899a44123b34b6dcc18b724336a2cae/node_modules/p-finally/"),
      packageDependencies: new Map([
        ["p-finally", "1.0.0"],
      ]),
    }],
  ])],
  ["strip-eof", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-eof-1.0.0-bb43ff5598a6eb05d89b59fcd129c983313606bf/node_modules/strip-eof/"),
      packageDependencies: new Map([
        ["strip-eof", "1.0.0"],
      ]),
    }],
  ])],
  ["widest-line", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-widest-line-2.0.1-7438764730ec7ef4381ce4df82fb98a53142a3fc/node_modules/widest-line/"),
      packageDependencies: new Map([
        ["string-width", "2.1.1"],
        ["widest-line", "2.0.1"],
      ]),
    }],
  ])],
  ["configstore", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-configstore-4.0.0-5933311e95d3687efb592c528b922d9262d227e7/node_modules/configstore/"),
      packageDependencies: new Map([
        ["dot-prop", "4.2.0"],
        ["graceful-fs", "4.2.2"],
        ["make-dir", "1.3.0"],
        ["unique-string", "1.0.0"],
        ["write-file-atomic", "2.4.3"],
        ["xdg-basedir", "3.0.0"],
        ["configstore", "4.0.0"],
      ]),
    }],
  ])],
  ["dot-prop", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-dot-prop-4.2.0-1f19e0c2e1aa0e32797c49799f2837ac6af69c57/node_modules/dot-prop/"),
      packageDependencies: new Map([
        ["is-obj", "1.0.1"],
        ["dot-prop", "4.2.0"],
      ]),
    }],
  ])],
  ["is-obj", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-obj-1.0.1-3e4729ac1f5fde025cd7d83a896dab9f4f67db0f/node_modules/is-obj/"),
      packageDependencies: new Map([
        ["is-obj", "1.0.1"],
      ]),
    }],
  ])],
  ["unique-string", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-unique-string-1.0.0-9e1057cca851abb93398f8b33ae187b99caec11a/node_modules/unique-string/"),
      packageDependencies: new Map([
        ["crypto-random-string", "1.0.0"],
        ["unique-string", "1.0.0"],
      ]),
    }],
  ])],
  ["crypto-random-string", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-crypto-random-string-1.0.0-a230f64f568310e1498009940790ec99545bca7e/node_modules/crypto-random-string/"),
      packageDependencies: new Map([
        ["crypto-random-string", "1.0.0"],
      ]),
    }],
  ])],
  ["write-file-atomic", new Map([
    ["2.4.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-write-file-atomic-2.4.3-1fd2e9ae1df3e75b8d8c367443c692d4ca81f481/node_modules/write-file-atomic/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["imurmurhash", "0.1.4"],
        ["signal-exit", "3.0.2"],
        ["write-file-atomic", "2.4.3"],
      ]),
    }],
  ])],
  ["xdg-basedir", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xdg-basedir-3.0.0-496b2cc109eca8dbacfe2dc72b603c17c5870ad4/node_modules/xdg-basedir/"),
      packageDependencies: new Map([
        ["xdg-basedir", "3.0.0"],
      ]),
    }],
  ])],
  ["has-yarn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-yarn-2.1.0-137e11354a7b5bf11aa5cb649cf0c6f3ff2b2e77/node_modules/has-yarn/"),
      packageDependencies: new Map([
        ["has-yarn", "2.1.0"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-yarn-1.0.0-89e25db604b725c8f5976fff0addc921b828a5a7/node_modules/has-yarn/"),
      packageDependencies: new Map([
        ["has-yarn", "1.0.0"],
      ]),
    }],
  ])],
  ["import-lazy", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-import-lazy-2.1.0-05698e3d45c88e8d7e9d92cb0584e77f096f3e43/node_modules/import-lazy/"),
      packageDependencies: new Map([
        ["import-lazy", "2.1.0"],
      ]),
    }],
  ])],
  ["is-ci", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-ci-2.0.0-6bc6334181810e04b5c22b3d589fdca55026404c/node_modules/is-ci/"),
      packageDependencies: new Map([
        ["ci-info", "2.0.0"],
        ["is-ci", "2.0.0"],
      ]),
    }],
  ])],
  ["is-installed-globally", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-installed-globally-0.1.0-0dfd98f5a9111716dd535dda6492f67bf3d25a80/node_modules/is-installed-globally/"),
      packageDependencies: new Map([
        ["global-dirs", "0.1.1"],
        ["is-path-inside", "1.0.1"],
        ["is-installed-globally", "0.1.0"],
      ]),
    }],
  ])],
  ["global-dirs", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-global-dirs-0.1.1-b319c0dd4607f353f3be9cca4c72fc148c49f445/node_modules/global-dirs/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
        ["global-dirs", "0.1.1"],
      ]),
    }],
  ])],
  ["ini", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
      ]),
    }],
  ])],
  ["is-path-inside", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-path-inside-1.0.1-8ef5b7de50437a3fdca6b4e865ef7aa55cb48036/node_modules/is-path-inside/"),
      packageDependencies: new Map([
        ["path-is-inside", "1.0.2"],
        ["is-path-inside", "1.0.1"],
      ]),
    }],
  ])],
  ["path-is-inside", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-is-inside-1.0.2-365417dede44430d1c11af61027facf074bdfc53/node_modules/path-is-inside/"),
      packageDependencies: new Map([
        ["path-is-inside", "1.0.2"],
      ]),
    }],
  ])],
  ["is-npm", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-npm-3.0.0-ec9147bfb629c43f494cf67936a961edec7e8053/node_modules/is-npm/"),
      packageDependencies: new Map([
        ["is-npm", "3.0.0"],
      ]),
    }],
  ])],
  ["is-yarn-global", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-yarn-global-0.3.0-d502d3382590ea3004893746754c89139973e232/node_modules/is-yarn-global/"),
      packageDependencies: new Map([
        ["is-yarn-global", "0.3.0"],
      ]),
    }],
  ])],
  ["latest-version", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-latest-version-5.1.0-119dfe908fe38d15dfa43ecd13fa12ec8832face/node_modules/latest-version/"),
      packageDependencies: new Map([
        ["package-json", "6.5.0"],
        ["latest-version", "5.1.0"],
      ]),
    }],
  ])],
  ["package-json", new Map([
    ["6.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-package-json-6.5.0-6feedaca35e75725876d0b0e64974697fed145b0/node_modules/package-json/"),
      packageDependencies: new Map([
        ["got", "9.6.0"],
        ["registry-auth-token", "4.0.0"],
        ["registry-url", "5.1.0"],
        ["semver", "6.3.0"],
        ["package-json", "6.5.0"],
      ]),
    }],
  ])],
  ["got", new Map([
    ["9.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-got-9.6.0-edf45e7d67f99545705de1f7bbeeeb121765ed85/node_modules/got/"),
      packageDependencies: new Map([
        ["@sindresorhus/is", "0.14.0"],
        ["@szmarczak/http-timer", "1.1.2"],
        ["cacheable-request", "6.1.0"],
        ["decompress-response", "3.3.0"],
        ["duplexer3", "0.1.4"],
        ["get-stream", "4.1.0"],
        ["lowercase-keys", "1.0.1"],
        ["mimic-response", "1.0.1"],
        ["p-cancelable", "1.1.0"],
        ["to-readable-stream", "1.0.0"],
        ["url-parse-lax", "3.0.0"],
        ["got", "9.6.0"],
      ]),
    }],
  ])],
  ["@sindresorhus/is", new Map([
    ["0.14.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@sindresorhus-is-0.14.0-9fb3a3cf3132328151f353de4632e01e52102bea/node_modules/@sindresorhus/is/"),
      packageDependencies: new Map([
        ["@sindresorhus/is", "0.14.0"],
      ]),
    }],
  ])],
  ["@szmarczak/http-timer", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-@szmarczak-http-timer-1.1.2-b1665e2c461a2cd92f4c1bbf50d5454de0d4b421/node_modules/@szmarczak/http-timer/"),
      packageDependencies: new Map([
        ["defer-to-connect", "1.0.2"],
        ["@szmarczak/http-timer", "1.1.2"],
      ]),
    }],
  ])],
  ["defer-to-connect", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-defer-to-connect-1.0.2-4bae758a314b034ae33902b5aac25a8dd6a8633e/node_modules/defer-to-connect/"),
      packageDependencies: new Map([
        ["defer-to-connect", "1.0.2"],
      ]),
    }],
  ])],
  ["cacheable-request", new Map([
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cacheable-request-6.1.0-20ffb8bd162ba4be11e9567d823db651052ca912/node_modules/cacheable-request/"),
      packageDependencies: new Map([
        ["clone-response", "1.0.2"],
        ["get-stream", "5.1.0"],
        ["http-cache-semantics", "4.0.3"],
        ["keyv", "3.1.0"],
        ["lowercase-keys", "2.0.0"],
        ["normalize-url", "4.4.1"],
        ["responselike", "1.0.2"],
        ["cacheable-request", "6.1.0"],
      ]),
    }],
  ])],
  ["clone-response", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-clone-response-1.0.2-d1dc973920314df67fbeb94223b4ee350239e96b/node_modules/clone-response/"),
      packageDependencies: new Map([
        ["mimic-response", "1.0.1"],
        ["clone-response", "1.0.2"],
      ]),
    }],
  ])],
  ["mimic-response", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mimic-response-1.0.1-4923538878eef42063cb8a3e3b0798781487ab1b/node_modules/mimic-response/"),
      packageDependencies: new Map([
        ["mimic-response", "1.0.1"],
      ]),
    }],
  ])],
  ["pump", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64/node_modules/pump/"),
      packageDependencies: new Map([
        ["end-of-stream", "1.4.4"],
        ["once", "1.4.0"],
        ["pump", "3.0.0"],
      ]),
    }],
  ])],
  ["end-of-stream", new Map([
    ["1.4.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0/node_modules/end-of-stream/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["end-of-stream", "1.4.4"],
      ]),
    }],
  ])],
  ["http-cache-semantics", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-http-cache-semantics-4.0.3-495704773277eeef6e43f9ab2c2c7d259dda25c5/node_modules/http-cache-semantics/"),
      packageDependencies: new Map([
        ["http-cache-semantics", "4.0.3"],
      ]),
    }],
  ])],
  ["keyv", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-keyv-3.1.0-ecc228486f69991e49e9476485a5be1e8fc5c4d9/node_modules/keyv/"),
      packageDependencies: new Map([
        ["json-buffer", "3.0.0"],
        ["keyv", "3.1.0"],
      ]),
    }],
  ])],
  ["json-buffer", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-buffer-3.0.0-5b1f397afc75d677bde8bcfc0e47e1f9a3d9a898/node_modules/json-buffer/"),
      packageDependencies: new Map([
        ["json-buffer", "3.0.0"],
      ]),
    }],
  ])],
  ["normalize-url", new Map([
    ["4.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-normalize-url-4.4.1-81e9c153b0ad5743755696f2aa20488d48e962b6/node_modules/normalize-url/"),
      packageDependencies: new Map([
        ["normalize-url", "4.4.1"],
      ]),
    }],
  ])],
  ["responselike", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-responselike-1.0.2-918720ef3b631c5642be068f15ade5a46f4ba1e7/node_modules/responselike/"),
      packageDependencies: new Map([
        ["lowercase-keys", "1.0.1"],
        ["responselike", "1.0.2"],
      ]),
    }],
  ])],
  ["decompress-response", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-decompress-response-3.3.0-80a4dd323748384bfa248083622aedec982adff3/node_modules/decompress-response/"),
      packageDependencies: new Map([
        ["mimic-response", "1.0.1"],
        ["decompress-response", "3.3.0"],
      ]),
    }],
  ])],
  ["duplexer3", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-duplexer3-0.1.4-ee01dd1cac0ed3cbc7fdbea37dc0a8f1ce002ce2/node_modules/duplexer3/"),
      packageDependencies: new Map([
        ["duplexer3", "0.1.4"],
      ]),
    }],
  ])],
  ["p-cancelable", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-p-cancelable-1.1.0-d078d15a3af409220c886f1d9a0ca2e441ab26cc/node_modules/p-cancelable/"),
      packageDependencies: new Map([
        ["p-cancelable", "1.1.0"],
      ]),
    }],
  ])],
  ["to-readable-stream", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-to-readable-stream-1.0.0-ce0aa0c2f3df6adf852efb404a783e77c0475771/node_modules/to-readable-stream/"),
      packageDependencies: new Map([
        ["to-readable-stream", "1.0.0"],
      ]),
    }],
  ])],
  ["url-parse-lax", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-url-parse-lax-3.0.0-16b5cafc07dbe3676c1b1999177823d6503acb0c/node_modules/url-parse-lax/"),
      packageDependencies: new Map([
        ["prepend-http", "2.0.0"],
        ["url-parse-lax", "3.0.0"],
      ]),
    }],
  ])],
  ["prepend-http", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-prepend-http-2.0.0-e92434bfa5ea8c19f41cdfd401d741a3c819d897/node_modules/prepend-http/"),
      packageDependencies: new Map([
        ["prepend-http", "2.0.0"],
      ]),
    }],
  ])],
  ["registry-auth-token", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-registry-auth-token-4.0.0-30e55961eec77379da551ea5c4cf43cbf03522be/node_modules/registry-auth-token/"),
      packageDependencies: new Map([
        ["rc", "1.2.8"],
        ["safe-buffer", "5.2.0"],
        ["registry-auth-token", "4.0.0"],
      ]),
    }],
  ])],
  ["rc", new Map([
    ["1.2.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed/node_modules/rc/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
        ["ini", "1.3.5"],
        ["minimist", "1.2.0"],
        ["strip-json-comments", "2.0.1"],
        ["rc", "1.2.8"],
      ]),
    }],
  ])],
  ["deep-extend", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac/node_modules/deep-extend/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
      ]),
    }],
  ])],
  ["registry-url", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-registry-url-5.1.0-e98334b50d5434b81136b44ec638d9c2009c5009/node_modules/registry-url/"),
      packageDependencies: new Map([
        ["rc", "1.2.8"],
        ["registry-url", "5.1.0"],
      ]),
    }],
  ])],
  ["semver-diff", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-diff-2.1.0-4bbb8437c8d37e4b0cf1a68fd726ec6d645d6d36/node_modules/semver-diff/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
        ["semver-diff", "2.1.0"],
      ]),
    }],
  ])],
  ["xo-init", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xo-init-0.7.0-634b4789e366b4f87f747ef0cee1a99ce273aa15/node_modules/xo-init/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
        ["execa", "0.9.0"],
        ["has-yarn", "1.0.0"],
        ["minimist", "1.2.0"],
        ["path-exists", "3.0.0"],
        ["read-pkg-up", "3.0.0"],
        ["the-argv", "1.0.0"],
        ["write-pkg", "3.2.0"],
        ["xo-init", "0.7.0"],
      ]),
    }],
  ])],
  ["the-argv", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-the-argv-1.0.0-0084705005730dd84db755253c931ae398db9522/node_modules/the-argv/"),
      packageDependencies: new Map([
        ["the-argv", "1.0.0"],
      ]),
    }],
  ])],
  ["write-pkg", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-write-pkg-3.2.0-0e178fe97820d389a8928bc79535dbe68c2cff21/node_modules/write-pkg/"),
      packageDependencies: new Map([
        ["sort-keys", "2.0.0"],
        ["write-json-file", "2.3.0"],
        ["write-pkg", "3.2.0"],
      ]),
    }],
  ])],
  ["sort-keys", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sort-keys-2.0.0-658535584861ec97d730d6cf41822e1f56684128/node_modules/sort-keys/"),
      packageDependencies: new Map([
        ["is-plain-obj", "1.1.0"],
        ["sort-keys", "2.0.0"],
      ]),
    }],
  ])],
  ["write-json-file", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-write-json-file-2.3.0-2b64c8a33004d54b8698c76d585a77ceb61da32f/node_modules/write-json-file/"),
      packageDependencies: new Map([
        ["detect-indent", "5.0.0"],
        ["graceful-fs", "4.2.2"],
        ["make-dir", "1.3.0"],
        ["pify", "3.0.0"],
        ["sort-keys", "2.0.0"],
        ["write-file-atomic", "2.4.3"],
        ["write-json-file", "2.3.0"],
      ]),
    }],
  ])],
  ["detect-indent", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-detect-indent-5.0.0-3871cc0a6a002e8c3e5b3cf7f336264675f06b9d/node_modules/detect-indent/"),
      packageDependencies: new Map([
        ["detect-indent", "5.0.0"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["6.9.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-qs-6.9.0-d1297e2a049c53119cb49cca366adbbacc80b409/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "6.9.0"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["inquirer", "7.0.0"],
        ["kleur", "3.0.3"],
        ["micro", "9.3.4"],
        ["xcall", "1.0.4"],
        ["xo", "0.25.3"],
        ["qs", "6.9.0"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../Library/Caches/Yarn/v4/npm-inquirer-7.0.0-9e2b032dde77da1db5db804758b8fea3a970519a/node_modules/inquirer/", {"name":"inquirer","reference":"7.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-inquirer-6.5.2-ad50942375d036d327ff528c08bd5fab089928ca/node_modules/inquirer/", {"name":"inquirer","reference":"6.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-escapes-4.2.1-4dccdb846c3eee10f6d64dea66273eab90c37228/node_modules/ansi-escapes/", {"name":"ansi-escapes","reference":"4.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-escapes-3.2.0-8780b98ff9dbf5638152d1f1fe5c1d7b4442976b/node_modules/ansi-escapes/", {"name":"ansi-escapes","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-type-fest-0.5.2-d6ef42a0356c6cd45f49485c3b6281fc148e48a2/node_modules/type-fest/", {"name":"type-fest","reference":"0.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-type-fest-0.6.0-8d2a2370d3df886eb5c90ada1c5bf6188acf838b/node_modules/type-fest/", {"name":"type-fest","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-type-fest-0.4.1-8bdf77743385d8a4f13ba95f610f5ccd68c728f8/node_modules/type-fest/", {"name":"type-fest","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-type-fest-0.3.1-63d00d204e059474fe5e1b7c011112bbd1dc29e1/node_modules/type-fest/", {"name":"type-fest","reference":"0.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-flag-2.0.0-e8207af1cc7b30d446cc70b734b5e8be18f88d51/node_modules/has-flag/", {"name":"has-flag","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b/node_modules/has-flag/", {"name":"has-flag","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-cursor-3.1.0-264305a7ae490d1d03bf0c9ba7c925d1753af307/node_modules/cli-cursor/", {"name":"cli-cursor","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-cursor-2.1.0-b35dac376479facc3e94747d41d0d0f5238ffcb5/node_modules/cli-cursor/", {"name":"cli-cursor","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-restore-cursor-3.1.0-39f67c54b3a7a58cea5236d95cf0034239631f7e/node_modules/restore-cursor/", {"name":"restore-cursor","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-restore-cursor-2.0.0-9f7ee287f82fd326d4fd162923d62129eee0dfaf/node_modules/restore-cursor/", {"name":"restore-cursor","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-onetime-5.1.0-fff0f3c91617fe62bb50189636e99ac8a6df7be5/node_modules/onetime/", {"name":"onetime","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-onetime-2.0.1-067428230fd67443b2794b22bba528b6867962d4/node_modules/onetime/", {"name":"onetime","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-mimic-fn-1.2.0-820c86a39334640e99516928bd03fca88057d022/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639/node_modules/cli-width/", {"name":"cli-width","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495/node_modules/external-editor/", {"name":"external-editor","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e/node_modules/chardet/", {"name":"chardet","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.19-f7468f60135f5e5dad3399c0a81be9a1603a082b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.19"}],
  ["../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9/node_modules/tmp/", {"name":"tmp","reference":"0.0.33"}],
  ["../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/", {"name":"os-tmpdir","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-figures-3.0.0-756275c964646163cc6f9197c7a0295dbfd04de9/node_modules/figures/", {"name":"figures","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-figures-2.0.0-3ab1a2d2a62c8bfb431a0c94cb797a2fce27c962/node_modules/figures/", {"name":"figures","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/", {"name":"lodash","reference":"4.17.15"}],
  ["../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.8-1630c42b2251ff81e2a283de96a5497ea92e5e0d/node_modules/mute-stream/", {"name":"mute-stream","reference":"0.0.8"}],
  ["../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.7-3075ce93bc21b8fab43e1bc4da7e8115ed1e7bab/node_modules/mute-stream/", {"name":"mute-stream","reference":"0.0.7"}],
  ["../../Library/Caches/Yarn/v4/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0/node_modules/run-async/", {"name":"run-async","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa/node_modules/is-promise/", {"name":"is-promise","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-rxjs-6.5.3-510e26317f4db91a7eb1de77d9dd9ba0a4899a3a/node_modules/rxjs/", {"name":"rxjs","reference":"6.5.3"}],
  ["../../Library/Caches/Yarn/v4/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a/node_modules/tslib/", {"name":"tslib","reference":"1.10.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-width-4.1.0-ba846d1daa97c3c596155308063e075ed1c99aff/node_modules/string-width/", {"name":"string-width","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/", {"name":"string-width","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-string-width-3.1.0-22767be21b62af1081574306f69ac51b62203961/node_modules/string-width/", {"name":"string-width","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"8.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"7.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/", {"name":"through","reference":"2.3.8"}],
  ["../../Library/Caches/Yarn/v4/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e/node_modules/kleur/", {"name":"kleur","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-micro-9.3.4-745a494e53c8916f64fb6a729f8cbf2a506b35ad/node_modules/micro/", {"name":"micro","reference":"9.3.4"}],
  ["../../Library/Caches/Yarn/v4/npm-arg-4.1.0-583c518199419e0037abb74062c37f8519e575f0/node_modules/arg/", {"name":"arg","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/", {"name":"content-type","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44/node_modules/is-stream/", {"name":"is-stream","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-raw-body-2.3.2-bcd60c77d3eb93cde0050295c3f379389bc88f89/node_modules/raw-body/", {"name":"raw-body","reference":"2.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048/node_modules/bytes/", {"name":"bytes","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-http-errors-1.6.2-0a002cc85707192a7e7946ceedc11155f60ec736/node_modules/http-errors/", {"name":"http-errors","reference":"1.6.2"}],
  ["../../Library/Caches/Yarn/v4/npm-depd-1.1.1-5783b4e1c459f06fa5ca27f991f3d06e7a310359/node_modules/depd/", {"name":"depd","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-setprototypeof-1.0.3-66567e37043eeb4f04d91bd658c0cbefb55b8e04/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/", {"name":"statuses","reference":"1.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/", {"name":"unpipe","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-xcall-1.0.4-26f7631f46197584117286951cb595b9d84db166/node_modules/xcall/", {"name":"xcall","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-promised-exec-1.0.1-50a11585798acb3b86fb613e103613333a30950a/node_modules/promised-exec/", {"name":"promised-exec","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-q-1.5.1-7e32f75b41381291d04611f1bf14109ac00651d7/node_modules/q/", {"name":"q","reference":"1.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-querystring-0.2.0-b209849203bb25df820da756e747005878521620/node_modules/querystring/", {"name":"querystring","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-xo-0.25.3-feb624c35943f3575ad4668cd0b7b74a1d4884d2/node_modules/xo/", {"name":"xo","reference":"0.25.3"}],
  ["../../Library/Caches/Yarn/v4/npm-arrify-2.0.1-c9655e9331e0abcd588d2a7cad7e9956f66701fa/node_modules/arrify/", {"name":"arrify","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/", {"name":"arrify","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/", {"name":"debug","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-6.4.0-5aa9227c3fbe921982b2eda94ba0d7fae858611a/node_modules/eslint/", {"name":"eslint","reference":"6.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@babel-code-frame-7.5.5-bc0782f6d69f7b7d49531219699b988f669a8f9d/node_modules/@babel/code-frame/", {"name":"@babel/code-frame","reference":"7.5.5"}],
  ["../../Library/Caches/Yarn/v4/npm-@babel-highlight-7.5.0-56d11312bd9248fa619591d02472be6e8cb32540/node_modules/@babel/highlight/", {"name":"@babel/highlight","reference":"7.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/", {"name":"esutils","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/", {"name":"js-tokens","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ajv-6.10.2-d3cea04d6b017b2894ad69040fec8b623eb4bd52/node_modules/ajv/", {"name":"ajv","reference":"6.10.2"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-deep-equal-2.0.1-7b05218ddf9667bf7f370bf7fdb2cb15fdd0aa49/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-json-stable-stringify-2.0.0-d5142c0caee6b1189f87d3a76111064f86c8bbf2/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0/node_modules/uri-js/", {"name":"uri-js","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/", {"name":"punycode","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"6.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-cross-spawn-5.1.0-e8bd0efee58fcff6f8f94510a0a554bbfa235449/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/", {"name":"nice-try","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/", {"name":"path-key","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/", {"name":"semver","reference":"6.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/", {"name":"shebang-command","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961/node_modules/doctrine/", {"name":"doctrine","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-doctrine-1.5.0-379dce730f6166f76cefa4e6707a159b02c5a6fa/node_modules/doctrine/", {"name":"doctrine","reference":"1.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-scope-5.0.0-e87c8887c73e8d1ec84f1ca591645c358bfc8fb9/node_modules/eslint-scope/", {"name":"eslint-scope","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-esrecurse-4.2.1-007a3b9fdbc2b3bb87e4879ea19c92fdbd3942cf/node_modules/esrecurse/", {"name":"esrecurse","reference":"4.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d/node_modules/estraverse/", {"name":"estraverse","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-utils-1.4.2-166a5180ef6ab7eb462f162fd0e6f2463d7309ab/node_modules/eslint-utils/", {"name":"eslint-utils","reference":"1.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-visitor-keys-1.1.0-e2a82cea84ff246ad6fb57f9bde5b46621459ec2/node_modules/eslint-visitor-keys/", {"name":"eslint-visitor-keys","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-espree-6.1.1-7f80e5f7257fc47db450022d723e356daeb1e5de/node_modules/espree/", {"name":"espree","reference":"6.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c/node_modules/acorn/", {"name":"acorn","reference":"7.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-jsx-5.0.2-84b68ea44b373c4f8686023a551f61a21b7c4a4f/node_modules/acorn-jsx/", {"name":"acorn-jsx","reference":"5.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-esquery-1.0.1-406c51658b1f5991a5f9b62b1dc25b00e3e5c708/node_modules/esquery/", {"name":"esquery","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-file-entry-cache-5.0.1-ca0f6efa6dd3d561333fb14515065c2fafdf439c/node_modules/file-entry-cache/", {"name":"file-entry-cache","reference":"5.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0/node_modules/flat-cache/", {"name":"flat-cache","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08/node_modules/flatted/", {"name":"flatted","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab/node_modules/rimraf/", {"name":"rimraf","reference":"2.6.3"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/", {"name":"glob","reference":"7.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3/node_modules/write/", {"name":"write","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/", {"name":"minimist","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-functional-red-black-tree-1.0.1-1b0ab3bd553b2a0d6399d29c0e3ea0b252078327/node_modules/functional-red-black-tree/", {"name":"functional-red-black-tree","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-parent-5.1.0-5f4c1d1e748d30cd73ad2944b3577a81b081e8c2/node_modules/glob-parent/", {"name":"glob-parent","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/", {"name":"glob-parent","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/", {"name":"is-glob","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-globals-11.12.0-ab8795338868a0babd8525758018c2a7eb95c42e/node_modules/globals/", {"name":"globals","reference":"11.12.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc/node_modules/ignore/", {"name":"ignore","reference":"4.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-ignore-5.1.4-84b7b3dbe64552b6ef0eca99f6743dbec6d97adf/node_modules/ignore/", {"name":"ignore","reference":"5.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-import-fresh-3.1.0-6d33fa1dcef6df930fae003446f33415af905118/node_modules/import-fresh/", {"name":"import-fresh","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2/node_modules/parent-module/", {"name":"parent-module","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73/node_modules/callsites/", {"name":"callsites","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6/node_modules/resolve-from/", {"name":"resolve-from","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69/node_modules/resolve-from/", {"name":"resolve-from","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.13.1"}],
  ["../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/", {"name":"esprima","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651/node_modules/json-stable-stringify-without-jsonify/", {"name":"json-stable-stringify-without-jsonify","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/", {"name":"levn","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/", {"name":"prelude-ls","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/", {"name":"type-check","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7/node_modules/natural-compare/", {"name":"natural-compare","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-optionator-0.8.2-364c5e409d3f4d6301d6c0b4c05bba50180aeb64/node_modules/optionator/", {"name":"optionator","reference":"0.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/", {"name":"deep-is","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/", {"name":"fast-levenshtein","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-wordwrap-1.0.0-27584810891456a4171c8d0226441ade90cbcaeb/node_modules/wordwrap/", {"name":"wordwrap","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-progress-2.0.3-7e8cf8d8f5b8f239c1bc68beb4eb78567d572ef8/node_modules/progress/", {"name":"progress","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-regexpp-2.0.1-8d19d31cf632482b589049f8281f93dbcba4d07f/node_modules/regexpp/", {"name":"regexpp","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-regexpp-3.0.0-dd63982ee3300e67b41c1956f850aa680d9d330e/node_modules/regexpp/", {"name":"regexpp","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-table-5.4.6-1292d19500ce3f86053b05f0e8e7e4a3bb21079e/node_modules/table/", {"name":"table","reference":"5.4.6"}],
  ["../../Library/Caches/Yarn/v4/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636/node_modules/slice-ansi/", {"name":"slice-ansi","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9/node_modules/astral-regex/", {"name":"astral-regex","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4/node_modules/text-table/", {"name":"text-table","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-v8-compile-cache-2.1.0-e14de37b31a6d194f5690d67efc4e7f6fc6ab30e/node_modules/v8-compile-cache/", {"name":"v8-compile-cache","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-config-prettier-6.3.0-e73b48e59dc49d950843f3eb96d519e2248286a3/node_modules/eslint-config-prettier/", {"name":"eslint-config-prettier","reference":"6.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-stdin-6.0.0-9e09bf712b360ab9225e812048f71fde9c89657b/node_modules/get-stdin/", {"name":"get-stdin","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-stdin-7.0.0-8d5de98f15171a125c5e516643c7a6d0ea8a96f6/node_modules/get-stdin/", {"name":"get-stdin","reference":"7.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-config-xo-0.27.1-e302231d4c054e855865c0f7c700ade23f506552/node_modules/eslint-config-xo/", {"name":"eslint-config-xo","reference":"0.27.1"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-formatter-pretty-2.1.1-0794a1009195d14e448053fe99667413b7d02e44/node_modules/eslint-formatter-pretty/", {"name":"eslint-formatter-pretty","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-rule-docs-1.1.158-aa85789f11b164ee5f9f8be38aa98456bf20dade/node_modules/eslint-rule-docs/", {"name":"eslint-rule-docs","reference":"1.1.158"}],
  ["../../Library/Caches/Yarn/v4/npm-log-symbols-2.2.0-5740e1c5d6f0dfda4ad9323b5332107ef6b4c40a/node_modules/log-symbols/", {"name":"log-symbols","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-plur-3.1.1-60267967866a8d811504fe58f2faaba237546a5b/node_modules/plur/", {"name":"plur","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-irregular-plurals-2.0.0-39d40f05b00f656d0b7fa471230dd3b714af2872/node_modules/irregular-plurals/", {"name":"irregular-plurals","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-hyperlinks-1.0.1-71daedf36cc1060ac5100c351bb3da48c29c0ef7/node_modules/supports-hyperlinks/", {"name":"supports-hyperlinks","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-ava-9.0.0-a8d569ae7127aa640e344c46d1f288976543b1bd/node_modules/eslint-plugin-ava/", {"name":"eslint-plugin-ava","reference":"9.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-deep-strict-equal-0.2.0-4a078147a8ab57f6a0d4f5547243cd22f44eb4e4/node_modules/deep-strict-equal/", {"name":"deep-strict-equal","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-core-assert-0.2.1-f85e2cf9bfed28f773cc8b3fa5c5b69bdc02fe3f/node_modules/core-assert/", {"name":"core-assert","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-buf-compare-1.0.1-fef28da8b8113a0a0db4430b0b6467b69730b34a/node_modules/buf-compare/", {"name":"buf-compare","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-error-2.2.2-c10ade187b3c93510c5470a5567833ee25649843/node_modules/is-error/", {"name":"is-error","reference":"2.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-enhance-visitors-1.0.0-aa945d05da465672a1ebd38fee2ed3da8518e95a/node_modules/enhance-visitors/", {"name":"enhance-visitors","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-espurify-2.0.1-c25b3bb613863daa142edcca052370a1a459f41d/node_modules/espurify/", {"name":"espurify","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-import-modules-1.1.0-748db79c5cc42bb9701efab424f894e72600e9dc/node_modules/import-modules/", {"name":"import-modules","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pkg-dir-2.0.0-f6d5d1109e19d63edf428e0bd57e12777615334b/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19/node_modules/find-up/", {"name":"find-up","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7/node_modules/find-up/", {"name":"find-up","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-find-up-3.0.0-49169f1d7993430646da61ecc5ae355c21c97b73/node_modules/find-up/", {"name":"find-up","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0/node_modules/locate-path/", {"name":"locate-path","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e/node_modules/locate-path/", {"name":"locate-path","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-locate-path-3.0.0-dbec3b3ab759758071b58fe59fc41871af21400e/node_modules/locate-path/", {"name":"locate-path","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07/node_modules/p-locate/", {"name":"p-locate","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43/node_modules/p-locate/", {"name":"p-locate","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-locate-3.0.0-322d69a05c0264b25997d9f40cd8a891ab0064a4/node_modules/p-locate/", {"name":"p-locate","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-limit-2.2.1-aa07a788cc3151c939b5131f63570f0dd2009537/node_modules/p-limit/", {"name":"p-limit","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8/node_modules/p-limit/", {"name":"p-limit","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6/node_modules/p-try/", {"name":"p-try","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3/node_modules/p-try/", {"name":"p-try","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3/node_modules/path-exists/", {"name":"path-exists","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515/node_modules/path-exists/", {"name":"path-exists","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-eslint-comments-3.1.2-4ef6c488dbe06aa1627fea107b3e5d059fc8a395/node_modules/eslint-plugin-eslint-comments/", {"name":"eslint-plugin-eslint-comments","reference":"3.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-import-2.18.2-02f1180b90b077b33d447a17a2326ceb400aceb6/node_modules/eslint-plugin-import/", {"name":"eslint-plugin-import","reference":"2.18.2"}],
  ["../../Library/Caches/Yarn/v4/npm-array-includes-3.0.3-184b48f62d92d7452bb31b323165c7f8bd02266d/node_modules/array-includes/", {"name":"array-includes","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-define-properties-1.1.3-cf88da6cbee26fe6db7094f61d870cbd84cee9f1/node_modules/define-properties/", {"name":"define-properties","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-object-keys-1.1.1-1c47f272df277f3b1daf061677d9c82e2322c60e/node_modules/object-keys/", {"name":"object-keys","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-es-abstract-1.14.2-7ce108fad83068c8783c3cdf62e504e084d8c497/node_modules/es-abstract/", {"name":"es-abstract","reference":"1.14.2"}],
  ["../../Library/Caches/Yarn/v4/npm-es-to-primitive-1.2.0-edf72478033456e8dda8ef09e00ad9650707f377/node_modules/es-to-primitive/", {"name":"es-to-primitive","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-callable-1.1.4-1e1adf219e1eeb684d691f9d6a05ff0d30a24d75/node_modules/is-callable/", {"name":"is-callable","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-is-date-object-1.0.1-9aa20eb6aeebbff77fbd33e74ca01b33581d3a16/node_modules/is-date-object/", {"name":"is-date-object","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-symbol-1.0.2-a055f6ae57192caee329e7a860118b497a950f38/node_modules/is-symbol/", {"name":"is-symbol","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-has-symbols-1.0.0-ba1a8f1af2a0fc39650f5c850367704122063b44/node_modules/has-symbols/", {"name":"has-symbols","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/", {"name":"has","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-is-regex-1.0.4-5517489b547091b0930e095654ced25ee97e9491/node_modules/is-regex/", {"name":"is-regex","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-object-inspect-1.6.0-c70b6cbf72f274aab4c34c0c82f5167bf82cf15b/node_modules/object-inspect/", {"name":"object-inspect","reference":"1.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-prototype-trimleft-2.1.0-6cc47f0d7eb8d62b0f3701611715a3954591d634/node_modules/string.prototype.trimleft/", {"name":"string.prototype.trimleft","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-prototype-trimright-2.1.0-669d164be9df9b6f7559fa8e89945b168a5a6c58/node_modules/string.prototype.trimright/", {"name":"string.prototype.trimright","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-contains-path-0.1.0-fe8cf184ff6670b6baef01a9d4861a5cbec4120a/node_modules/contains-path/", {"name":"contains-path","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-import-resolver-node-0.3.2-58f15fb839b8d0576ca980413476aab2472db66a/node_modules/eslint-import-resolver-node/", {"name":"eslint-import-resolver-node","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/", {"name":"resolve","reference":"1.12.0"}],
  ["../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-module-utils-2.4.1-7b4675875bf96b0dbf1b21977456e5bb1f5e018c/node_modules/eslint-module-utils/", {"name":"eslint-module-utils","reference":"2.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-object-values-1.1.0-bf6810ef5da3e5325790eaaa2be213ea84624da9/node_modules/object.values/", {"name":"object.values","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-up-2.0.0-6b72a8048984e0c41e79510fd5e9fa99b3b549be/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-up-6.0.0-da75ce72762f2fa1f20c5a40d4dd80c77db969e3/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"6.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-up-3.0.0-3ed496685dba0f8fe118d0691dc51f4a1ff96f07/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-2.0.0-8ef1c0623c6a6db0dc6713c4bfac46332b2368f8/node_modules/read-pkg/", {"name":"read-pkg","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-5.2.0-7bf295438ca5a33e56cd30e053b34ee7250c93cc/node_modules/read-pkg/", {"name":"read-pkg","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-3.0.0-9cbc686978fee65d16c00e2b19c237fcf6e38389/node_modules/read-pkg/", {"name":"read-pkg","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-load-json-file-2.0.0-7947e42149af80d696cbf797bcaabcfe1fe29ca8/node_modules/load-json-file/", {"name":"load-json-file","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-load-json-file-4.0.0-2f5f45ab91e33216234fd53adab668eb4ec0993b/node_modules/load-json-file/", {"name":"load-json-file","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-load-json-file-5.3.0-4d3c1e01fa1c03ea78a60ac7af932c9ce53403f3/node_modules/load-json-file/", {"name":"load-json-file","reference":"5.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/", {"name":"parse-json","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-json-5.0.0-73e5114c986d143efa3712d4ea24db9a4266f60f/node_modules/parse-json/", {"name":"parse-json","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-json-4.0.0-be35f5425be1f7f6c747184f98a788cb99477ee0/node_modules/parse-json/", {"name":"parse-json","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/", {"name":"pify","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pify-3.0.0-e5a4acd2c101fdf3d9a4d07f0dbc4db49dd28176/node_modules/pify/", {"name":"pify","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pify-4.0.1-4b2cd25c50d598735c50292224fd8c6df41e3231/node_modules/pify/", {"name":"pify","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3/node_modules/strip-bom/", {"name":"strip-bom","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.8.4"}],
  ["../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-path-type-2.0.0-f012ccb8415b7096fc2daa1054c3d72389594c73/node_modules/path-type/", {"name":"path-type","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-path-type-3.0.0-cef31dc8e0a1a3bb0d105c0cd97cf3bf47f4e36f/node_modules/path-type/", {"name":"path-type","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-no-use-extend-native-0.4.1-b2a631219b6a2e91b4370ef6559a754356560a40/node_modules/eslint-plugin-no-use-extend-native/", {"name":"eslint-plugin-no-use-extend-native","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-get-set-prop-1.0.0-2731877e4d78a6a69edcce6bb9d68b0779e76312/node_modules/is-get-set-prop/", {"name":"is-get-set-prop","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-set-props-0.1.0-998475c178445686d0b32246da5df8dbcfbe8ea3/node_modules/get-set-props/", {"name":"get-set-props","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lowercase-keys-1.0.1-6f9e30b47084d971a7c820ff15a6c5167b74c26f/node_modules/lowercase-keys/", {"name":"lowercase-keys","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lowercase-keys-2.0.0-2603e78b7b4b0006cbca2fbcc8a3202558ac9479/node_modules/lowercase-keys/", {"name":"lowercase-keys","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-js-type-2.0.0-73617006d659b4eb4729bba747d28782df0f7e22/node_modules/is-js-type/", {"name":"is-js-type","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-js-types-1.0.0-d242e6494ed572ad3c92809fc8bed7f7687cbf03/node_modules/js-types/", {"name":"js-types","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-obj-prop-1.0.0-b34de79c450b8d7c73ab2cdf67dc875adb85f80e/node_modules/is-obj-prop/", {"name":"is-obj-prop","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-obj-props-1.2.0-3dbaa849f30238d84206c8b7192e1ce54d0d43b2/node_modules/obj-props/", {"name":"obj-props","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-proto-prop-2.0.0-99ab2863462e44090fd083efd1929058f9d935e1/node_modules/is-proto-prop/", {"name":"is-proto-prop","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-proto-props-2.0.0-8ac6e6dec658545815c623a3bc81580deda9a181/node_modules/proto-props/", {"name":"proto-props","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-node-10.0.0-fd1adbc7a300cf7eb6ac55cf4b0b6fc6e577f5a6/node_modules/eslint-plugin-node/", {"name":"eslint-plugin-node","reference":"10.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-es-2.0.0-0f5f5da5f18aa21989feebe8a73eadefb3432976/node_modules/eslint-plugin-es/", {"name":"eslint-plugin-es","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-prettier-3.1.1-507b8562410d02a03f0ddc949c616f877852f2ba/node_modules/eslint-plugin-prettier/", {"name":"eslint-plugin-prettier","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-prettier-linter-helpers-1.0.0-d23d41fe1375646de2d0104d3454a3008802cf7b/node_modules/prettier-linter-helpers/", {"name":"prettier-linter-helpers","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-diff-1.2.0-73ee11982d86caaf7959828d519cfe927fac5f03/node_modules/fast-diff/", {"name":"fast-diff","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-promise-4.2.1-845fd8b2260ad8f82564c1222fce44ad71d9418a/node_modules/eslint-plugin-promise/", {"name":"eslint-plugin-promise","reference":"4.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-plugin-unicorn-12.0.1-f902c3c80dbc027fb3bd4665713c3dcb1954bc6a/node_modules/eslint-plugin-unicorn/", {"name":"eslint-plugin-unicorn","reference":"12.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ci-info-2.0.0-67a9e964be31a51e15e5010d58e6f12834002f46/node_modules/ci-info/", {"name":"ci-info","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-clean-regexp-1.0.0-8df7c7aae51fd36874e8f8d05b9180bc11a3fed7/node_modules/clean-regexp/", {"name":"clean-regexp","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-ast-utils-1.1.0-3d58ba557801cfb1c941d68131ee9f8c34bd1586/node_modules/eslint-ast-utils/", {"name":"eslint-ast-utils","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-get-4.4.2-2d177f652fa31e939b4438d5341499dfa3825e99/node_modules/lodash.get/", {"name":"lodash.get","reference":"4.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-zip-4.2.0-ec6662e4896408ed4ab6c542a3990b72cc080020/node_modules/lodash.zip/", {"name":"lodash.zip","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-eslint-template-visitor-1.1.0-f090d124d1a52e05552149fc50468ed59608b166/node_modules/eslint-template-visitor/", {"name":"eslint-template-visitor","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-multimap-1.0.2-6aa76fc3233905ba948bbe4c74dc2c3a0356eb36/node_modules/multimap/", {"name":"multimap","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-camelcase-4.3.0-b28aa6288a2b9fc651035c7711f65ab6190331a6/node_modules/lodash.camelcase/", {"name":"lodash.camelcase","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-defaultsdeep-4.6.1-512e9bd721d272d94e3d3a63653fa17516741ca6/node_modules/lodash.defaultsdeep/", {"name":"lodash.defaultsdeep","reference":"4.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-kebabcase-4.1.1-8489b1cb0d29ff88195cceca448ff6d6cc295c36/node_modules/lodash.kebabcase/", {"name":"lodash.kebabcase","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-snakecase-4.1.1-39d714a35357147837aefd64b5dcbb16becd8f8d/node_modules/lodash.snakecase/", {"name":"lodash.snakecase","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-topairs-4.3.0-3b6deaa37d60fb116713c46c5f17ea190ec48d64/node_modules/lodash.topairs/", {"name":"lodash.topairs","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-upperfirst-4.3.1-1365edf431480481ef0d1c68957a5ed99d49f7ce/node_modules/lodash.upperfirst/", {"name":"lodash.upperfirst","reference":"4.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-@types-normalize-package-data-2.4.0-e486d0d97396d79beedd0a6e33f4534ff6b4973e/node_modules/@types/normalize-package-data/", {"name":"@types/normalize-package-data","reference":"2.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-json-parse-better-errors-1.0.2-bb867cfb3450e69107c131d1c514bab3dc8bcaa9/node_modules/json-parse-better-errors/", {"name":"json-parse-better-errors","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-lines-and-columns-1.1.6-1c00c743b433cd0a4e80758f7b64a57440d9ff00/node_modules/lines-and-columns/", {"name":"lines-and-columns","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-reserved-words-0.1.2-00a0940f98cd501aeaaac316411d9adc52b31ab1/node_modules/reserved-words/", {"name":"reserved-words","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-regex-2.0.2-3601b28d3aefe4b963d42f6c2cdb241265cbd63c/node_modules/safe-regex/", {"name":"safe-regex","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/", {"name":"safe-regex","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-regexp-tree-0.1.14-1abca3675f6cc4b0dee5c959c6c4554ed172dfae/node_modules/regexp-tree/", {"name":"regexp-tree","reference":"0.1.14"}],
  ["../../Library/Caches/Yarn/v4/npm-find-cache-dir-3.0.0-cd4b7dd97b7185b7e17dbfe2d6e4115ee3eeb8fc/node_modules/find-cache-dir/", {"name":"find-cache-dir","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-commondir-1.0.1-ddd800da0c66127393cca5950ea968a3aaf1253b/node_modules/commondir/", {"name":"commondir","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-make-dir-3.0.0-1b5f39f6b9270ed33f9f054c5c0f84304989f801/node_modules/make-dir/", {"name":"make-dir","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-make-dir-1.3.0-79c1033b80515bd6d24ec9933e860ca75ee27f0c/node_modules/make-dir/", {"name":"make-dir","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-globby-9.2.0-fd029a706c703d29bdd170f4b6db3a3f7a7cb63d/node_modules/globby/", {"name":"globby","reference":"9.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@types-glob-7.1.1-aa59a1c6e3fbc421e07ccd31a944c30eba521575/node_modules/@types/glob/", {"name":"@types/glob","reference":"7.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-@types-events-3.0.0-2862f3f58a9a7f7c3e78d79f130dd4d71c25c2a7/node_modules/@types/events/", {"name":"@types/events","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@types-minimatch-3.0.3-3dca0e3f33b200fc7d1139c0cd96c1268cadfd9d/node_modules/@types/minimatch/", {"name":"@types/minimatch","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-@types-node-12.7.8-cb1bf6800238898bc2ff6ffa5702c3cadd350708/node_modules/@types/node/", {"name":"@types/node","reference":"12.7.8"}],
  ["../../Library/Caches/Yarn/v4/npm-array-union-1.0.2-9a34410e4f4e3da23dea375be5be70f24778ec39/node_modules/array-union/", {"name":"array-union","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-array-union-2.1.0-b798420adbeb1de828d84acd8a2e23d3efe85e8d/node_modules/array-union/", {"name":"array-union","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-array-uniq-1.0.3-af6ac877a25cc7f74e058894753858dfdb24fdb6/node_modules/array-uniq/", {"name":"array-uniq","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-dir-glob-2.2.2-fa09f0694153c8918b18ba0deafae94769fc50c4/node_modules/dir-glob/", {"name":"dir-glob","reference":"2.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-glob-2.2.7-6953857c3afa475fff92ee6015d52da70a4cd39d/node_modules/fast-glob/", {"name":"fast-glob","reference":"2.2.7"}],
  ["../../Library/Caches/Yarn/v4/npm-@mrmlnc-readdir-enhanced-2.2.1-524af240d1a360527b730475ecfa1344aa540dde/node_modules/@mrmlnc/readdir-enhanced/", {"name":"@mrmlnc/readdir-enhanced","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-call-me-maybe-1.0.1-26d208ea89e37b5cbde60250a15f031c16a4d66b/node_modules/call-me-maybe/", {"name":"call-me-maybe","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-to-regexp-0.3.0-8c5a1494d2066c570cc3bfe4496175acc4d502ab/node_modules/glob-to-regexp/", {"name":"glob-to-regexp","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@nodelib-fs-stat-1.1.3-2b5a3ab3f918cca48a8c754c08168e3f03eba61b/node_modules/@nodelib/fs.stat/", {"name":"@nodelib/fs.stat","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/", {"name":"path-dirname","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-merge2-1.3.0-5b366ee83b2f1582c48f87e47cf1a9352103ca81/node_modules/merge2/", {"name":"merge2","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/", {"name":"micromatch","reference":"3.1.10"}],
  ["../../Library/Caches/Yarn/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/", {"name":"arr-diff","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/", {"name":"array-unique","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/", {"name":"braces","reference":"2.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/", {"name":"arr-flatten","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/", {"name":"is-extendable","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/", {"name":"is-extendable","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/", {"name":"fill-range","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/", {"name":"is-number","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/", {"name":"kind-of","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/", {"name":"kind-of","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/", {"name":"isobject","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/", {"name":"repeat-element","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/", {"name":"snapdragon","reference":"0.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/", {"name":"base","reference":"0.11.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/", {"name":"cache-base","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/", {"name":"collection-visit","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/", {"name":"map-visit","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/", {"name":"object-visit","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/", {"name":"component-emitter","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/", {"name":"get-value","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/", {"name":"has-value","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/", {"name":"has-value","reference":"0.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/", {"name":"has-values","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/", {"name":"has-values","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/", {"name":"set-value","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/", {"name":"split-string","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/", {"name":"assign-symbols","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/", {"name":"to-object-path","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/", {"name":"union-value","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/", {"name":"arr-union","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/", {"name":"unset-value","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/", {"name":"class-utils","reference":"0.3.6"}],
  ["../../Library/Caches/Yarn/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/", {"name":"define-property","reference":"0.2.5"}],
  ["../../Library/Caches/Yarn/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/", {"name":"define-property","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/", {"name":"define-property","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"0.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"0.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/", {"name":"static-extend","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/", {"name":"object-copy","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/", {"name":"copy-descriptor","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/", {"name":"mixin-deep","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/", {"name":"for-in","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/", {"name":"pascalcase","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/", {"name":"map-cache","reference":"0.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/", {"name":"source-map-resolve","reference":"0.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/", {"name":"atob","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/", {"name":"decode-uri-component","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/", {"name":"resolve-url","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/", {"name":"source-map-url","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/", {"name":"urix","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/", {"name":"use","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/", {"name":"snapdragon-node","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/", {"name":"snapdragon-util","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/", {"name":"to-regex","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/", {"name":"regex-not","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/", {"name":"ret","reference":"0.1.15"}],
  ["../../Library/Caches/Yarn/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/", {"name":"extglob","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"2.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/", {"name":"posix-character-classes","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/", {"name":"fragment-cache","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/", {"name":"nanomatch","reference":"1.2.13"}],
  ["../../Library/Caches/Yarn/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/", {"name":"is-windows","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/", {"name":"object.pick","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-slash-2.0.0-de552851a1759df3a8f206535442f5ec4ddeab44/node_modules/slash/", {"name":"slash","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634/node_modules/slash/", {"name":"slash","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-isequal-4.5.0-415c4478f2bcc30120c22ce10ed3226f7d3e18e0/node_modules/lodash.isequal/", {"name":"lodash.isequal","reference":"4.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-mergewith-4.6.2-617121f89ac55f59047c7aec1ccd6654c6590f55/node_modules/lodash.mergewith/", {"name":"lodash.mergewith","reference":"4.6.2"}],
  ["../../Library/Caches/Yarn/v4/npm-meow-5.0.0-dfc73d63a9afc714a5e371760eb5c88b91078aa4/node_modules/meow/", {"name":"meow","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-camelcase-keys-4.2.0-a2aa5fb1af688758259c32c141426d78923b9b77/node_modules/camelcase-keys/", {"name":"camelcase-keys","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-camelcase-4.1.0-d545635be1e33c542649c69173e5de6acfae34dd/node_modules/camelcase/", {"name":"camelcase","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-camelcase-5.3.1-e3c9b31569e106811df242f715725a1f4c494320/node_modules/camelcase/", {"name":"camelcase","reference":"5.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-map-obj-2.0.0-a65cd29087a92598b8791257a523e021222ac1f9/node_modules/map-obj/", {"name":"map-obj","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-map-obj-1.0.1-d933ceb9205d82bdcf4886f6742bdc2b4dea146d/node_modules/map-obj/", {"name":"map-obj","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-quick-lru-1.1.0-4360b17c61136ad38078397ff11416e186dcfbb8/node_modules/quick-lru/", {"name":"quick-lru","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-decamelize-keys-1.1.0-d171a87933252807eb3cb61dc1c1445d078df2d9/node_modules/decamelize-keys/", {"name":"decamelize-keys","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-loud-rejection-1.6.0-5b46f80147edee578870f086d04821cf998e551f/node_modules/loud-rejection/", {"name":"loud-rejection","reference":"1.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-currently-unhandled-0.4.1-988df33feab191ef799a61369dd76c17adf957ea/node_modules/currently-unhandled/", {"name":"currently-unhandled","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-array-find-index-1.0.2-df010aa1287e164bbda6f9723b0a96a1ec4187a1/node_modules/array-find-index/", {"name":"array-find-index","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-options-3.0.2-fba4c8191339e13ecf4d61beb03f070103f3d954/node_modules/minimist-options/", {"name":"minimist-options","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-plain-obj-1.1.0-71a50c8429dfca773c92a390a4a03b39fcd51d3e/node_modules/is-plain-obj/", {"name":"is-plain-obj","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-redent-2.0.0-c1b2007b42d57eb1389079b3c8333639d5e1ccaa/node_modules/redent/", {"name":"redent","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-indent-string-3.2.0-4a5fd6d27cc332f37e5419a504dbb837105c9289/node_modules/indent-string/", {"name":"indent-string","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-indent-2.0.0-5ef8db295d01e6ed6cbf7aab96998d7822527b68/node_modules/strip-indent/", {"name":"strip-indent","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-trim-newlines-2.0.0-b403d0b91be50c331dfc4b82eeceb22c3de16d20/node_modules/trim-newlines/", {"name":"trim-newlines","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-yargs-parser-10.1.0-7202265b89f7e9e9f2e5765e0fe735a905edbaa8/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"10.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-multimatch-4.0.0-8c3c0f6e3e8449ada0af3dd29efb491a375191b3/node_modules/multimatch/", {"name":"multimatch","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-array-differ-3.0.0-3cbb3d0f316810eafcc47624734237d6aee4ae6b/node_modules/array-differ/", {"name":"array-differ","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-open-editor-2.0.1-d001055770fbf6f6ee73c18f224915f444be863c/node_modules/open-editor/", {"name":"open-editor","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-env-editor-0.4.1-77011e08ce45f46e404e8d996b465c684ca57502/node_modules/env-editor/", {"name":"env-editor","reference":"0.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-line-column-path-2.0.0-439aff48ef80d74c475801a25b560d021acf1288/node_modules/line-column-path/", {"name":"line-column-path","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-open-6.4.0-5c13e96d0dc894686164f18965ecfe889ecfc8a9/node_modules/open/", {"name":"open","reference":"6.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/", {"name":"is-wsl","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pkg-conf-3.1.0-d9f9c75ea1bae0e77938cde045b276dac7cc69ae/node_modules/pkg-conf/", {"name":"pkg-conf","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-prettier-1.18.2-6823e7c5900017b4bd3acf46fe9ac4b4d7bda9ea/node_modules/prettier/", {"name":"prettier","reference":"1.18.2"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d/node_modules/resolve-cwd/", {"name":"resolve-cwd","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-update-notifier-3.0.1-78ecb68b915e2fd1be9f767f6e298ce87b736250/node_modules/update-notifier/", {"name":"update-notifier","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-boxen-3.2.0-fbdff0de93636ab4450886b6ff45b92d098f45eb/node_modules/boxen/", {"name":"boxen","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-align-3.0.0-b536b371cf687caaef236c18d3e21fe3797467cb/node_modules/ansi-align/", {"name":"ansi-align","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-boxes-2.2.0-538ecae8f9c6ca508e3c3c95b453fe93cb4c168d/node_modules/cli-boxes/", {"name":"cli-boxes","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-term-size-1.2.0-458b83887f288fc56d6fffbfad262e26638efa69/node_modules/term-size/", {"name":"term-size","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-execa-0.7.0-944becd34cc41ee32a63a9faf27ad5a65fc59777/node_modules/execa/", {"name":"execa","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v4/npm-execa-0.9.0-adb7ce62cf985071f60580deb4a88b9e34712d01/node_modules/execa/", {"name":"execa","reference":"0.9.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lru-cache-4.1.5-8bbe50ea85bed59bc9e33dcab8235ee9bcf443cd/node_modules/lru-cache/", {"name":"lru-cache","reference":"4.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-pseudomap-1.0.2-f052a28da70e618917ef0a8ac34c1ae5a68286b3/node_modules/pseudomap/", {"name":"pseudomap","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-yallist-2.1.2-1c11f9218f076089a47dd512f93c6699a6a81d52/node_modules/yallist/", {"name":"yallist","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-get-stream-3.0.0-8e943d1358dc37555054ecbe2edb05aa174ede14/node_modules/get-stream/", {"name":"get-stream","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-stream-5.1.0-01203cdc92597f9b909067c3e656cc1f4d3c4dc9/node_modules/get-stream/", {"name":"get-stream","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-stream-4.1.0-c1b255575f3dc21d59bfc79cd3d2b46b1c3a54b5/node_modules/get-stream/", {"name":"get-stream","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-npm-run-path-2.0.2-35a9232dfa35d7067b4cb2ddf2357b1871536c5f/node_modules/npm-run-path/", {"name":"npm-run-path","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-p-finally-1.0.0-3fbcfb15b899a44123b34b6dcc18b724336a2cae/node_modules/p-finally/", {"name":"p-finally","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-eof-1.0.0-bb43ff5598a6eb05d89b59fcd129c983313606bf/node_modules/strip-eof/", {"name":"strip-eof","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-widest-line-2.0.1-7438764730ec7ef4381ce4df82fb98a53142a3fc/node_modules/widest-line/", {"name":"widest-line","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-configstore-4.0.0-5933311e95d3687efb592c528b922d9262d227e7/node_modules/configstore/", {"name":"configstore","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-dot-prop-4.2.0-1f19e0c2e1aa0e32797c49799f2837ac6af69c57/node_modules/dot-prop/", {"name":"dot-prop","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-obj-1.0.1-3e4729ac1f5fde025cd7d83a896dab9f4f67db0f/node_modules/is-obj/", {"name":"is-obj","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-unique-string-1.0.0-9e1057cca851abb93398f8b33ae187b99caec11a/node_modules/unique-string/", {"name":"unique-string","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-crypto-random-string-1.0.0-a230f64f568310e1498009940790ec99545bca7e/node_modules/crypto-random-string/", {"name":"crypto-random-string","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-write-file-atomic-2.4.3-1fd2e9ae1df3e75b8d8c367443c692d4ca81f481/node_modules/write-file-atomic/", {"name":"write-file-atomic","reference":"2.4.3"}],
  ["../../Library/Caches/Yarn/v4/npm-xdg-basedir-3.0.0-496b2cc109eca8dbacfe2dc72b603c17c5870ad4/node_modules/xdg-basedir/", {"name":"xdg-basedir","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-yarn-2.1.0-137e11354a7b5bf11aa5cb649cf0c6f3ff2b2e77/node_modules/has-yarn/", {"name":"has-yarn","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-yarn-1.0.0-89e25db604b725c8f5976fff0addc921b828a5a7/node_modules/has-yarn/", {"name":"has-yarn","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-import-lazy-2.1.0-05698e3d45c88e8d7e9d92cb0584e77f096f3e43/node_modules/import-lazy/", {"name":"import-lazy","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-ci-2.0.0-6bc6334181810e04b5c22b3d589fdca55026404c/node_modules/is-ci/", {"name":"is-ci","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-installed-globally-0.1.0-0dfd98f5a9111716dd535dda6492f67bf3d25a80/node_modules/is-installed-globally/", {"name":"is-installed-globally","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-global-dirs-0.1.1-b319c0dd4607f353f3be9cca4c72fc148c49f445/node_modules/global-dirs/", {"name":"global-dirs","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/", {"name":"ini","reference":"1.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-is-path-inside-1.0.1-8ef5b7de50437a3fdca6b4e865ef7aa55cb48036/node_modules/is-path-inside/", {"name":"is-path-inside","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-path-is-inside-1.0.2-365417dede44430d1c11af61027facf074bdfc53/node_modules/path-is-inside/", {"name":"path-is-inside","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-npm-3.0.0-ec9147bfb629c43f494cf67936a961edec7e8053/node_modules/is-npm/", {"name":"is-npm","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-yarn-global-0.3.0-d502d3382590ea3004893746754c89139973e232/node_modules/is-yarn-global/", {"name":"is-yarn-global","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-latest-version-5.1.0-119dfe908fe38d15dfa43ecd13fa12ec8832face/node_modules/latest-version/", {"name":"latest-version","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-package-json-6.5.0-6feedaca35e75725876d0b0e64974697fed145b0/node_modules/package-json/", {"name":"package-json","reference":"6.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-got-9.6.0-edf45e7d67f99545705de1f7bbeeeb121765ed85/node_modules/got/", {"name":"got","reference":"9.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@sindresorhus-is-0.14.0-9fb3a3cf3132328151f353de4632e01e52102bea/node_modules/@sindresorhus/is/", {"name":"@sindresorhus/is","reference":"0.14.0"}],
  ["../../Library/Caches/Yarn/v4/npm-@szmarczak-http-timer-1.1.2-b1665e2c461a2cd92f4c1bbf50d5454de0d4b421/node_modules/@szmarczak/http-timer/", {"name":"@szmarczak/http-timer","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-defer-to-connect-1.0.2-4bae758a314b034ae33902b5aac25a8dd6a8633e/node_modules/defer-to-connect/", {"name":"defer-to-connect","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cacheable-request-6.1.0-20ffb8bd162ba4be11e9567d823db651052ca912/node_modules/cacheable-request/", {"name":"cacheable-request","reference":"6.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-clone-response-1.0.2-d1dc973920314df67fbeb94223b4ee350239e96b/node_modules/clone-response/", {"name":"clone-response","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-mimic-response-1.0.1-4923538878eef42063cb8a3e3b0798781487ab1b/node_modules/mimic-response/", {"name":"mimic-response","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64/node_modules/pump/", {"name":"pump","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0/node_modules/end-of-stream/", {"name":"end-of-stream","reference":"1.4.4"}],
  ["../../Library/Caches/Yarn/v4/npm-http-cache-semantics-4.0.3-495704773277eeef6e43f9ab2c2c7d259dda25c5/node_modules/http-cache-semantics/", {"name":"http-cache-semantics","reference":"4.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-keyv-3.1.0-ecc228486f69991e49e9476485a5be1e8fc5c4d9/node_modules/keyv/", {"name":"keyv","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-json-buffer-3.0.0-5b1f397afc75d677bde8bcfc0e47e1f9a3d9a898/node_modules/json-buffer/", {"name":"json-buffer","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-normalize-url-4.4.1-81e9c153b0ad5743755696f2aa20488d48e962b6/node_modules/normalize-url/", {"name":"normalize-url","reference":"4.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-responselike-1.0.2-918720ef3b631c5642be068f15ade5a46f4ba1e7/node_modules/responselike/", {"name":"responselike","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-decompress-response-3.3.0-80a4dd323748384bfa248083622aedec982adff3/node_modules/decompress-response/", {"name":"decompress-response","reference":"3.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-duplexer3-0.1.4-ee01dd1cac0ed3cbc7fdbea37dc0a8f1ce002ce2/node_modules/duplexer3/", {"name":"duplexer3","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-p-cancelable-1.1.0-d078d15a3af409220c886f1d9a0ca2e441ab26cc/node_modules/p-cancelable/", {"name":"p-cancelable","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-to-readable-stream-1.0.0-ce0aa0c2f3df6adf852efb404a783e77c0475771/node_modules/to-readable-stream/", {"name":"to-readable-stream","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-url-parse-lax-3.0.0-16b5cafc07dbe3676c1b1999177823d6503acb0c/node_modules/url-parse-lax/", {"name":"url-parse-lax","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-prepend-http-2.0.0-e92434bfa5ea8c19f41cdfd401d741a3c819d897/node_modules/prepend-http/", {"name":"prepend-http","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-registry-auth-token-4.0.0-30e55961eec77379da551ea5c4cf43cbf03522be/node_modules/registry-auth-token/", {"name":"registry-auth-token","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed/node_modules/rc/", {"name":"rc","reference":"1.2.8"}],
  ["../../Library/Caches/Yarn/v4/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac/node_modules/deep-extend/", {"name":"deep-extend","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-registry-url-5.1.0-e98334b50d5434b81136b44ec638d9c2009c5009/node_modules/registry-url/", {"name":"registry-url","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-diff-2.1.0-4bbb8437c8d37e4b0cf1a68fd726ec6d645d6d36/node_modules/semver-diff/", {"name":"semver-diff","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-xo-init-0.7.0-634b4789e366b4f87f747ef0cee1a99ce273aa15/node_modules/xo-init/", {"name":"xo-init","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v4/npm-the-argv-1.0.0-0084705005730dd84db755253c931ae398db9522/node_modules/the-argv/", {"name":"the-argv","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-write-pkg-3.2.0-0e178fe97820d389a8928bc79535dbe68c2cff21/node_modules/write-pkg/", {"name":"write-pkg","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-sort-keys-2.0.0-658535584861ec97d730d6cf41822e1f56684128/node_modules/sort-keys/", {"name":"sort-keys","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-write-json-file-2.3.0-2b64c8a33004d54b8698c76d585a77ceb61da32f/node_modules/write-json-file/", {"name":"write-json-file","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-detect-indent-5.0.0-3871cc0a6a002e8c3e5b3cf7f336264675f06b9d/node_modules/detect-indent/", {"name":"detect-indent","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-qs-6.9.0-d1297e2a049c53119cb49cca366adbbacc80b409/node_modules/qs/", {"name":"qs","reference":"6.9.0"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 169 && relativeLocation[168] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 169)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 163 && relativeLocation[162] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 163)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 153 && relativeLocation[152] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 153)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 151 && relativeLocation[150] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 151)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 118 && relativeLocation[117] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 118)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 100 && relativeLocation[99] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 100)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 97 && relativeLocation[96] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 97)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
