//@flow
import { ADS, ACTION_TYPE_UPDATE_FRAGMENT, ACTION_TYPE_UNINDEX, ACTION_TYPE_REINDEX } from './ads';

function createAugmentedDatastore(datastore: Object): Object {
  return new ADS(datastore);
}

export {
  createAugmentedDatastore,
  ACTION_TYPE_UPDATE_FRAGMENT,
  ACTION_TYPE_UNINDEX,
  ACTION_TYPE_REINDEX,
};
