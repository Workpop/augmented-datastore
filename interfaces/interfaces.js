declare type OnMessageAction = {
  action: 'updateFragment' | 'unindex' | 'reindex';
  ids: [string]; // the ids affected
  fragmentData: ?any; // if action is updateFrament then can override the fragment otherwise will invoke buildFragment
}

declare class DataStore {
  index(doc: Object): void;
  unindex(id: string): void;
  get(id: string): Object;
}

declare class FragmentConfig {
  id: string;
  init(): void;
  onMessage(message: any): OnMessageAction;
  buildFragment(id: string): any;
}
