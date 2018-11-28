'use strict';

const mock = require('egg-mock');

describe('test/sequelize-typescript.test.js', () => {
  let app;
  before(() => {
    app = mock.app({
      baseDir: 'apps/sequelize-typescript-test',
    });
    return app.ready();
  });

  after(() => app.close());
  afterEach(mock.restore);

  it('should GET /', () => {
    return app.httpRequest()
      .get('/')
      .expect('hi, sequelizeTypescript')
      .expect(200);
  });
});
