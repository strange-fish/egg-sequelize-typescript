'use strict';

const path = require('path');
const sleep = require('mz-modules/sleep');
const AUTH_RETRIES = Symbol('authenticateRetries');

module.exports = app => {
  const defaultConfig = {
    delegate: 'model',
    baseDir: 'model',
    logging(...args) {
      // if benchmark enabled, log used
      const used = typeof args[1] === 'number' ? `(${args[1]}ms)` : '';
      app.logger.info('[egg-sequelize]%s %s', used, args[0]);
    },
    host: 'localhost',
    port: 3306,
    username: 'root',
    benchmark: true,
    define: {
      freezeTableName: false,
      underscored: true,
    },
  };

  const config = app.config.sequelizeTypescript;
  // support customize sequelize
  app.Sequelize = config.Sequelize || require('sequelize-typescript').Sequelize;

  const databases = [];
  if (!config.datasources) {
    databases.push(loadDatabase(Object.assign({}, defaultConfig, config)));
  } else {
    config.datasources.forEach(datasource => {
      databases.push(
        loadDatabase(Object.assign({}, defaultConfig, datasource))
      );
    });
  }

  app.beforeStart(async () => {
    await Promise.all(databases.map(database => authenticate(database)));
  });

  /**
   * load databse to app[config.delegate
   * @param {Object} config config for load
   *   - delegate: load model to app[delegate]
   *   - baeDir: where model located
   *   - other sequelize configures(databasem username, password, etc...)
   * @return {Object} sequelize instance
   */
  function loadDatabase(config = {}) {
    if (typeof config.ignore === 'string' || Array.isArray(config.ignore)) {
      app.deprecate(
        `[egg-sequelize] if you want to exclude ${
          config.ignore
        } when load models, please set to config.sequelize.exclude instead of config.sequelize.ignore`
      );
      config.exclude = config.ignore;
      delete config.ignore;
    }
    const sequelize = new app.Sequelize(config);

    const delegate = config.delegate.split('.');

    let model = app;
    let context = app.context;

    if (delegate.length > 1) {
      delegate.forEach(path => {
        model = model[path] = model[path] || {};
        context = context[path] = context[path] || {};
      });
    }
    const lastDelegate = delegate[delegate.length - 1];

    if (model[lastDelegate]) {
      throw new Error(
        `[egg-sequelize] app[${config.delegate}] is already defined`
      );
    }

    Object.defineProperty(model, lastDelegate, {
      value: sequelize,
      writable: false,
      configurable: true,
    });

    const DELEGATE = Symbol(`context#sequelize_${config.delegate}`);
    Object.defineProperty(context, lastDelegate, {
      get() {
        // context.model is different with app.model
        // so we can change the properties of ctx.model.xxx
        if (!this[DELEGATE]) { this[DELEGATE] = Object.create(model[lastDelegate]); }
        return this[DELEGATE];
      },
      configurable: true,
    });

    const modelDir = path.join(app.baseDir, 'app', config.baseDir);

    const models = [];
    const target = Symbol(config.delegate);

    app.loader.loadToApp(modelDir, target, {
      caseStyle: 'upper',
      ignore: config.exclude,
      filter(model) {
        if (!model) return false;
        models.push(model);
        return true;
      },
      initializer(modelClass) {
        if (typeof modelClass === 'function') {
          modelClass.app = app;
          return modelClass;
        }
      },
    });
    Object.assign(model[lastDelegate], app[target]);
    sequelize.addModels(models);

    return model[lastDelegate];
  }

  /**
   * Authenticate to test Database connection.
   *
   * This method will retry 3 times when database connect fail in temporary, to avoid Egg start failed.
   * @param {Application} database instance of sequelize
   */
  async function authenticate(database) {
    database[AUTH_RETRIES] = database[AUTH_RETRIES] || 0;

    try {
      await database.authenticate();
    } catch (e) {
      if (e.name !== 'SequelizeConnectionRefusedError') throw e;
      if (app.model[AUTH_RETRIES] >= 3) throw e;

      // sleep 2s to retry, max 3 times
      database[AUTH_RETRIES] += 1;
      app.logger.warn(
        `Sequelize Error: ${e.message}, sleep 2 seconds to retry...`
      );
      await sleep(2000);
      await authenticate(app, database);
    }
  }
};
