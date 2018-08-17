// @flow
import {
  get,
  each,
  flatMap,
  groupBy,
  includes,
  map,
  mapKeys,
  partial,
  reduce,
} from 'lodash';
import _log from './log';

export const ACTION_TYPE_UNINDEX = 'unindex';
export const ACTION_TYPE_REINDEX = 'reindex';
export const ACTION_TYPE_UPDATE_FRAGMENT = 'updateFragment';

const log = partial(_log, 'ADS');

export class ADS {
  destinationStore: Object;
  fragmentConfigs: Object;
  onMessage: Function;

  constructor(_destinationStore: Object) {
    this.fragmentConfigs = {};
    this.destinationStore = _destinationStore;

    this.onMessage = this.onMessage.bind(this);
  }

  withFragment(fragmentConfig: Object): Object {
    const fragmentId = get(fragmentConfig, 'id');
    this.fragmentConfigs[fragmentId] = fragmentConfig;

    return this;
  }

  init(): Object {
    each(this.fragmentConfigs, (fragmentConfig: Object) => {
      // fragments may want to subscribe to events here
      fragmentConfig.init(this.onMessage);
    });

    return this;
  }

  /**
   * Build the document from scratch by combining the results of building each fragment of the
   * document
   *
   * @param id
   */
  async index(id: string): Promise<any> {
    const fragments = await Promise.all(
      map(
        this.fragmentConfigs,
        async (config: Object): Object => {
          const fragment = await config.buildFragment(id);

          const fragmentId = config.id;
          return {
            fragment,
            fragmentId,
          };
        }
      )
    );

    const doc = reduce(
      fragments,
      (memo: Object, { fragment, fragmentId }: Object): Object => {
        return Object.assign({}, memo, {
          [fragmentId]: fragment,
          _fragLastUpdate: {
            ...get(memo, '_fragLastUpdate'),
            [fragmentId]: new Date(),
          },
        });
      },
      {
        _fragLastUpdate: {},
      }
    );

    log('TRACE', `indexing: ${id} ${JSON.stringify(doc)}`);

    this.destinationStore.index(Object.assign(doc, { _id: id }));
  }

  /**
   * Remove the document from the underlying datastore.
   *
   * @param id
   */
  unindex(id: string) {
    log('TRACE', `unindexing: ${id}`);
    this.destinationStore.unindex(id);
  }

  async onMessage(message: any): Promise<any> {
    // pass message to each fragment
    const updates = reduce(
      this.fragmentConfigs,
      (memo: Array<Object>, fragmentConfig: Object): Array<Object> => {
        const update = fragmentConfig.onMessage(message);

        // an update will look like the following:
        // {
        //   "ids": ["abc", "def"],
        //   "action": "updateFragment"
        // }

        if (!update) {
          return memo;
        }

        return memo.concat({
          fragmentId: fragmentConfig.id,
          update,
        });
      },
      []
    );
    // reconcile all the updates
    log('TRACE', `updates to be applied: ${JSON.stringify(updates)}`);

    // updates will look like: [{"fragmentId":"status","update":{"ids":["app1"],"action":"updateFragment"}}]
    await this._applyUpdates(updates);
  }

  async _applyUpdates(updates: Array<Object>): Promise<any> {
    // each update could affect multiple documents.  Here we flatten the updates so that
    // each update only has one document.
    // $FlowFixMe
    const singleIdUpdates = flatMap(
      updates,
      (fragmentUpdate: Object): Array<Object> => {
        const fragmentId = get(fragmentUpdate, 'fragmentId');
        const update = get(fragmentUpdate, 'update');
        const { ids, ...rest } = update;

        // return an array of updates, each with a single document id
        return map(
          ids,
          (id: string): any => {
            return {
              id,
              fragmentId,
              ...rest,
            };
          }
        );
      }
    );

    // group updates by doc id
    const groupedById = groupBy(
      singleIdUpdates,
      (update: Object): string => {
        return get(update, 'id');
      }
    );

    const groupedKeys = mapKeys(
      groupedById,
      async (value: Array<Object>, key: string): Promise<any> => {
        await this._applyUpdatesToDoc(key, value);
      }
    );

    await groupedKeys;
  }

  async _applyUpdatesToDoc(id: string, updates: Array<Object>): Promise<any> {
    log('TRACE', '_applyUpdatesToDoc', id, JSON.stringify(updates));
    const ops = map(updates, 'action');

    if (includes(ops, ACTION_TYPE_UNINDEX)) {
      if (
        includes(ops, ACTION_TYPE_UPDATE_FRAGMENT) ||
        includes(ops, ACTION_TYPE_REINDEX)
      ) {
        log('ERROR', 'combined unindex and index operations');
        return;
      }

      log('INFO', `Unindexing doc ${id}`);
      this.unindex(id);
      return;
    }

    if (includes(ops, ACTION_TYPE_REINDEX)) {
      log('TRACE', '_applyUpdatesToDoc - reindex', id);
      this.index(id);
      return;
    }

    const existingDoc = this.destinationStore.get(id);
    if (!existingDoc) {
      log(
        'TRACE',
        "_applyUpdatesToDoc - existing doc doesn't exist - reindexing",
        id
      );
      this.index(id);
      return;
    }

    const updatedDoc = await reduce(
      updates,
      async (memo: Object, update: Object): Object => {
        const { fragmentId } = update;
        const fragmentConfig = this.fragmentConfigs[fragmentId];
        if (fragmentConfig) {
          const fragment = await fragmentConfig.buildFragment(id);
          return Object.assign(memo, {
            [fragmentId]: fragment,
            _fragLastUpdate: {
              ...get(memo, '_fragLastUpdate'),
              [fragmentId]: new Date(),
            },
          });
        }

        return memo;
      },
      existingDoc
    );

    log(
      'TRACE',
      '_applyUpdatesToDoc - updating doc',
      JSON.stringify(updatedDoc)
    );

    this.destinationStore.index(updatedDoc);
  }
}
