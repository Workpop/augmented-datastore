// @flow
import { compact, get, each, flatMap, groupBy, includes, map, mapKeys, partial, reduce } from 'lodash';
import _log from './log';

export const ACTION_TYPE_UNINDEX = 'unindex';
export const ACTION_TYPE_REINDEX = 'reindex';
export const ACTION_TYPE_UPDATE_FRAGMENT = 'updateFragment';

const log = partial(_log, 'ADS');

export class ADS {
  destinationStore: DataStore;
  fragmentConfigs: Array<FragmentConfig>;

  constructor(_destinationStore: Object) {
    this.fragmentConfigs = {};
    this.destinationStore = _destinationStore;
  }

  withFragment(fragmentConfig: FragmentConfig): Object {
    const fragmentId = get(fragmentConfig, 'id');
    this.fragmentConfigs[fragmentId] = fragmentConfig;

    return this;
  }

  init() {
    each(this.fragmentConfigs, (fragmentConfig: FragmentConfig) => {
      // fragments may want to subscribe to events here
      fragmentConfig.init();
    });

    return this;
  }

  index(id: string) {
    const doc = reduce(this.fragmentConfigs, (memo: Object, fragmentConfig: FragmentConfig): Object => {
      const fragment = fragmentConfig.buildFragment(id);

      const fragmentId = fragmentConfig.id;

      return Object.assign({}, memo, {
        [fragmentId]: fragment,
        _fragLastUpdate: {
          ...get(memo, '_fragLastUpdate'),
          [fragmentId]: new Date(),
        },
      });
    }, {
      _id: id,
      _fragLastUpdate: {},
    });

    this.destinationStore.index(doc);
  }

  unindex(id: string) {
    this.destinationStore.unindex(id);
  }

  onMessage(message: any) {
    // pass message to each fragment
    const updates = reduce(this.fragmentConfigs, (memo, fragmentConfig: FragmentConfig) => {
      const update = fragmentConfig.onMessage(message);

      if (!update) {
        return memo;
      }

      return memo.concat({
        fragmentId: fragmentConfig.id,
        update,
      });
    }, []);
    // reconcile all the updates
    log('TRACE', JSON.stringify(updates));

    this._applyUpdates(updates);
  }

  _applyUpdates(updates) {
    const singleIdUpdates = flatMap(updates, (fragmentUpdate) => {
      const fragmentId = get(fragmentUpdate, 'fragmentId');
      const update = get(fragmentUpdate, 'update');
      const {ids, ...rest} = update;
      return map(ids, (id) => {
        return {
          id,
          fragmentId,
          ...rest,
        };
      });
    });

    const groupedById = groupBy(singleIdUpdates, (update) => {
      return get(update, 'id');
    });

    mapKeys(groupedById, (value, key) => {
      this._applyUpdatesToDoc(key, value);
    });
  }

  _applyUpdatesToDoc(id, updates) {
    const ops = map(updates, 'action');

    if (includes(ops, ACTION_TYPE_UNINDEX)) {
      if (includes(ops, ACTION_TYPE_UPDATE_FRAGMENT) || includes(ops, ACTION_TYPE_REINDEX)) {
        log('ERROR', 'combined unindex and index operations');
        return;
      }

      log('INFO', `Unindexing doc ${id}`);
      this.unindex(id);
      return;
    }

    if (includes(ops, ACTION_TYPE_REINDEX)) {
      this.index(id);
      return;
    }

    const existingDoc = this.destinationStore.get(id);
    if (!existingDoc) {
      this.index(id);
      return;
    }

    const updatedDoc = reduce(updates, (memo, update) => {
      const {fragmentId} = update;
      const fragmentConfig = this.fragmentConfigs[fragmentId];
      if (fragmentConfig) {
        const fragment = fragmentConfig.buildFragment(id);
        return Object.assign(memo, {
          [fragmentId]: fragment,
          _fragLastUpdate: {
            ...get(memo, '_fragLastUpdate'),
            [fragmentId]: new Date(),
          },
        });
      }

      return memo;
    }, existingDoc);

    this.destinationStore.index(updatedDoc);
  }
}
