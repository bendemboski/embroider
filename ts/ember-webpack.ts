import { Packager } from "ember-cli-vanilla";
import webpack from 'webpack';
import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { JSDOM } from 'jsdom';
import isEqual from 'lodash/isEqual';

const Webpack: Packager = class Webpack {
  constructor(
    private pathToVanillaApp: string,
    private outputPath: string,
    private templateCompiler: (moduleName: string, templateContents: string) => string,
    private consoleWrite: (msg: string) => void
    ) {
  }

  private examineApp() {
    let packageJSON = JSON.parse(readFileSync(join(this.pathToVanillaApp, 'package.json'), 'utf8'));
    let entrypoints = packageJSON['ember-addon'].entrypoints.map(entrypoint => {
      let document = new JSDOM(readFileSync(join(this.pathToVanillaApp, entrypoint), 'utf8')).window.document;
      let scripts = [...document.querySelectorAll('script')].filter(s => !s.hasAttribute('async')).map(s => s.src.replace(/^\//, this.pathToVanillaApp + '/'));
      return { name: entrypoint, scripts };
    });
    let externals = packageJSON['ember-addon'].externals;
    return { entrypoints, externals };
  }

  private configureWebpack({ entrypoints, externals }) {

    let entry = {};
    entrypoints.forEach(entrypoint => {
      entry[basename(entrypoint.name, '.html')] = entrypoint.scripts.slice();
    });

    let amdExternals = {};
    externals.forEach(external => {
      amdExternals[external] = `require("${externals}")`;
    });

    return {
      mode: 'development', // todo
      context: this.pathToVanillaApp,
      entry,
      module: {
        rules: [
          {
            test: /\.hbs$/,
            use: [
              {
                loader: join(__dirname, './webpack-hbs-loader'),
                options: { templateCompiler: this.templateCompiler }
              }
            ]
          }
        ]
      },
      output: {
        path: this.outputPath,
        filename: `chunk.[chunkhash].js`,
        chunkFilename: `chunk.[chunkhash].js`,
      },
      optimization: {
        splitChunks: {
          chunks: 'all'
        }
      },
      externals: amdExternals
    };
  }

  private lastConfig;
  private lastWebpack;

  private getWebpack(config) {
    if (this.lastWebpack && isEqual(config, this.lastConfig)) {
      return this.lastWebpack;
    }
    this.lastConfig = config;
    return this.lastWebpack = webpack(config);
  }

  async build(): Promise<void> {
    let appInfo = this.examineApp();
    let config = this.configureWebpack(appInfo);
    let webpack = this.getWebpack(config);
    await this.runWebpack(webpack);
  }
  private runWebpack(webpack): Promise<any> {
    return new Promise((resolve, reject) => {
      webpack.run((err, stats) => {
        if (err) {
          this.consoleWrite(stats.toString());
          reject(err);
          return;
        }
        if (stats.hasErrors()) {
          let templateError = stats.compilation.errors.find(e => e.error && e.error.type === 'Template Compiler Error');
          if (templateError) {
            reject(templateError.error);
          } else {
            this.consoleWrite(stats.toString());
            reject(new Error('webpack returned errors to ember-auto-import'));
          }
          return;
        }
        if (stats.hasWarnings() || process.env.AUTO_IMPORT_VERBOSE) {
          this.consoleWrite(stats.toString());
        }
        resolve(stats.toJson());
      });
    });
  }
};
export { Webpack };
