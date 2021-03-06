import { A } from '@ember/array';
import { run } from '@ember/runloop';
import setupStore from 'dummy/tests/helpers/store';
import OrderedSet from '@ember/ordered-set';

import { module, test } from 'qunit';

import DS from 'ember-data';

let store, env, manager;

const Person = DS.Model.extend({
  name: DS.attr('string'),
  cars: DS.hasMany('car', { async: false }),
});

const Car = DS.Model.extend({
  make: DS.attr('string'),
  model: DS.attr('string'),
  person: DS.belongsTo('person', { async: false }),
});

module('integration/record_array_manager', function(hooks) {
  hooks.beforeEach(function() {
    env = setupStore({
      adapter: DS.RESTAdapter.extend(),
    });
    store = env.store;

    manager = store.recordArrayManager;

    env.owner.register('model:car', Car);
    env.owner.register('model:person', Person);
  });

  function tap(obj, methodName, callback) {
    let old = obj[methodName];

    let summary = { called: [] };

    obj[methodName] = function() {
      let result = old.apply(obj, arguments);
      if (callback) {
        callback.apply(obj, arguments);
      }
      summary.called.push(arguments);
      return result;
    };

    return summary;
  }

  test('destroying the store correctly cleans everything up', function(assert) {
    let query = {};
    let person;

    run(() => {
      store.push({
        data: {
          type: 'car',
          id: '1',
          attributes: {
            make: 'BMC',
            model: 'Mini Cooper',
          },
          relationships: {
            person: {
              data: { type: 'person', id: '1' },
            },
          },
        },
      });
    });

    run(() => {
      store.push({
        data: {
          type: 'person',
          id: '1',
          attributes: {
            name: 'Tom Dale',
          },
          relationships: {
            cars: {
              data: [{ type: 'car', id: '1' }],
            },
          },
        },
      });
      person = store.peekRecord('person', 1);
    });

    let all = store.peekAll('person');
    let adapterPopulated = manager.createAdapterPopulatedRecordArray('person', query);
    let allSummary = tap(all, 'willDestroy');
    let adapterPopulatedSummary = tap(adapterPopulated, 'willDestroy');
    let internalPersonModel = person._internalModel;

    assert.equal(allSummary.called.length, 0);
    assert.equal(adapterPopulatedSummary.called.length, 0);
    assert.equal(
      internalPersonModel._recordArrays.size,
      1,
      'expected the person to be a member of 1 recordArrays'
    );
    assert.equal('person' in manager._liveRecordArrays, true);

    run(all, all.destroy);

    assert.equal(
      internalPersonModel._recordArrays.size,
      0,
      'expected the person to be a member of 1 recordArrays'
    );
    assert.equal(allSummary.called.length, 1);
    assert.equal('person' in manager._liveRecordArrays, false);

    run(manager, manager.destroy);

    assert.equal(
      internalPersonModel._recordArrays.size,
      0,
      'expected the person to be a member of no recordArrays'
    );
    assert.equal(allSummary.called.length, 1);
    assert.equal(adapterPopulatedSummary.called.length, 1);
  });

  test('batch liveRecordArray changes', function(assert) {
    let cars = store.peekAll('car');
    let arrayContentWillChangeCount = 0;

    cars.arrayContentWillChange = function(startIndex, removeCount, addedCount) {
      arrayContentWillChangeCount++;
      assert.equal(startIndex, 0, 'expected 0 startIndex');
      assert.equal(removeCount, 0, 'expected 0 removed');
      assert.equal(addedCount, 2, 'expected 2 added');
    };

    assert.deepEqual(cars.toArray(), []);
    assert.equal(arrayContentWillChangeCount, 0, 'expected NO arrayChangeEvents yet');

    run(() => {
      store.push({
        data: [
          {
            type: 'car',
            id: '1',
            attributes: {
              make: 'BMC',
              model: 'Mini Cooper',
            },
          },
          {
            type: 'car',
            id: '2',
            attributes: {
              make: 'Jeep',
              model: 'Wrangler',
            },
          },
        ],
      });
    });

    assert.equal(arrayContentWillChangeCount, 1, 'expected ONE array change event');

    assert.deepEqual(cars.toArray(), [store.peekRecord('car', 1), store.peekRecord('car', 2)]);

    run(() => store.peekRecord('car', 1).set('model', 'Mini'));

    assert.equal(arrayContentWillChangeCount, 1, 'expected ONE array change event');

    cars.arrayContentWillChange = function(startIndex, removeCount, addedCount) {
      arrayContentWillChangeCount++;
      assert.equal(startIndex, 2, 'expected a start index of TWO');
      assert.equal(removeCount, 0, 'expected no removes');
      assert.equal(addedCount, 1, 'expected ONE add');
    };

    arrayContentWillChangeCount = 0;

    run(() => {
      store.push({
        data: [
          {
            type: 'car',
            id: 2, // this ID is already present, array wont need to change
            attributes: {
              make: 'Tesla',
              model: 'S',
            },
          },
        ],
      });
    });

    assert.equal(arrayContentWillChangeCount, 0, 'expected NO array change events');

    run(() => {
      store.push({
        data: [
          {
            type: 'car',
            id: 3,
            attributes: {
              make: 'Tesla',
              model: 'S',
            },
          },
        ],
      });
    });

    assert.equal(arrayContentWillChangeCount, 1, 'expected ONE array change event');
  });

  test('#GH-4041 store#query AdapterPopulatedRecordArrays are removed from their managers instead of retained when #destroy is called', function(assert) {
    run(() => {
      store.push({
        data: {
          type: 'car',
          id: '1',
          attributes: {
            make: 'Honda',
            model: 'fit',
          },
        },
      });
    });

    const query = {};

    let adapterPopulated = manager.createAdapterPopulatedRecordArray('car', query);

    run(() => adapterPopulated.destroy());

    assert.equal(manager._adapterPopulatedRecordArrays.length, 0);
  });

  test('createRecordArray', function(assert) {
    let recordArray = manager.createRecordArray('foo');

    assert.equal(recordArray.modelName, 'foo');
    assert.equal(recordArray.isLoaded, true);
    assert.equal(recordArray.manager, manager);
    assert.deepEqual(recordArray.get('content'), []);
    assert.deepEqual(recordArray.toArray(), []);
  });

  test('createRecordArray with optional content', function(assert) {
    let record = {};
    let internalModel = {
      _recordArrays: new OrderedSet(),
      getRecord() {
        return record;
      },
    };
    let content = A([internalModel]);
    let recordArray = manager.createRecordArray('foo', content);

    assert.equal(recordArray.modelName, 'foo');
    assert.equal(recordArray.isLoaded, true);
    assert.equal(recordArray.manager, manager);
    assert.equal(recordArray.get('content'), content);
    assert.deepEqual(recordArray.toArray(), [record]);

    assert.deepEqual(internalModel._recordArrays.toArray(), [recordArray]);
  });

  test('liveRecordArrayFor always return the same array for a given type', function(assert) {
    assert.equal(manager.liveRecordArrayFor('foo'), manager.liveRecordArrayFor('foo'));
  });

  test('liveRecordArrayFor create with content', function(assert) {
    assert.expect(6);

    let createRecordArrayCalled = 0;
    let superCreateRecordArray = manager.createRecordArray;

    manager.createRecordArray = function(modelName, internalModels) {
      createRecordArrayCalled++;
      assert.equal(modelName, 'car');
      assert.equal(internalModels.length, 1);
      assert.equal(internalModels[0].id, 1);
      return superCreateRecordArray.apply(this, arguments);
    };

    run(() => {
      store.push({
        data: {
          type: 'car',
          id: '1',
          attributes: {
            make: 'BMC',
            model: 'Mini Cooper',
          },
        },
      });
    });

    assert.equal(createRecordArrayCalled, 0, 'no record array has been created yet');
    manager.liveRecordArrayFor('car');
    assert.equal(createRecordArrayCalled, 1, 'one record array is created');
    manager.liveRecordArrayFor('car');
    assert.equal(createRecordArrayCalled, 1, 'no new record array is created');
  });

  test('[DEPRECATED FILTER SUPPORT until 3.5]', function(assert) {
    let cars = store.peekAll('car');
    let arrayContentWillChangeCount = 0;
    let updatesWithoutLiveArrayChangeCount = 0;
    let updatesSignaledCount = 0;

    let originalUpdate = store.recordArrayManager.updateLiveRecordArray;
    store.recordArrayManager.updateLiveRecordArray = function(recordArray, internalModels) {
      updatesSignaledCount++;
      let didUpdate = originalUpdate.call(store.recordArrayManager, recordArray, internalModels);

      if (!didUpdate) {
        updatesWithoutLiveArrayChangeCount++;
      }

      return didUpdate;
    };

    cars.arrayContentWillChange = function() {
      arrayContentWillChangeCount++;
    };

    assert.deepEqual(cars.toArray(), []);
    assert.equal(arrayContentWillChangeCount, 0, 'expected NO arrayChangeEvents yet');
    assert.equal(updatesWithoutLiveArrayChangeCount, 0, 'expected NO silent updates yet');
    assert.equal(updatesSignaledCount, 0, 'expected NO signals yet');

    let [car1, car2] = run(() =>
      store.push({
        data: [
          {
            type: 'car',
            id: '1',
            attributes: {
              make: 'BMC',
              model: 'Mini Cooper',
            },
          },
          {
            type: 'car',
            id: '2',
            attributes: {
              make: 'Jeep',
              model: 'Wrangler',
            },
          },
        ],
      })
    );

    assert.equal(arrayContentWillChangeCount, 1, 'expected ONE array change event');
    assert.equal(updatesWithoutLiveArrayChangeCount, 0, 'expected NO silent updates yet');
    assert.equal(updatesSignaledCount, 1, 'expected ONE signal');
    assert.deepEqual(cars.toArray(), [car1, car2]);

    arrayContentWillChangeCount = 0;
    updatesWithoutLiveArrayChangeCount = 0;
    updatesSignaledCount = 0;

    run(() => car1.set('model', 'Mini'));

    assert.equal(arrayContentWillChangeCount, 0, 'expected no array change events');
    assert.equal(updatesWithoutLiveArrayChangeCount, 1, 'expected ONE silent update');
    assert.equal(updatesSignaledCount, 1, 'expected ONE total signals');

    arrayContentWillChangeCount = 0;
    updatesWithoutLiveArrayChangeCount = 0;
    updatesSignaledCount = 0;

    run(() =>
      store.push({
        data: {
          type: 'car',
          id: '2', // this ID is already present, array wont need to change
          attributes: {
            make: 'Tesla',
            model: 'S',
          },
        },
      })
    );

    assert.equal(arrayContentWillChangeCount, 0, 'expected NO array change events');
    assert.equal(updatesWithoutLiveArrayChangeCount, 1, 'expected ONE silent update');
    assert.equal(updatesSignaledCount, 1, 'expected ONE total signals');

    arrayContentWillChangeCount = 0;
    updatesWithoutLiveArrayChangeCount = 0;
    updatesSignaledCount = 0;

    run(() =>
      store.push({
        data: {
          type: 'car',
          id: '3',
          attributes: {
            make: 'Tesla',
            model: 'S',
          },
        },
      })
    );

    assert.equal(arrayContentWillChangeCount, 1, 'expected ONE array change event');
    assert.equal(updatesWithoutLiveArrayChangeCount, 0, 'expected ONE silent update');
    assert.equal(updatesSignaledCount, 1, 'expected ONE total signals');
  });
});
