import { filter, get, noop, set, size } from 'lodash';
import { createAugmentedDatastore, ACTION_TYPE_UPDATE_FRAGMENT } from '../src/index';

const expect = require('chai').expect;

const sourceDataApplication = {
  'app1': {
    candidateId: '123',
    jobId: 'job1',
    status: 1,
  },
  'app2': {
    candidateId: '456',
    jobId: 'job2',
    status: 1,
  },
};

const sourceDataNotes = {
  'note1': {
    applicationId: 'app1',
    note: 'awesome app',
  },
  'note2': {
    applicationId: 'app2',
    note: 'loved the video',
  },
  'note3': {
    applicationId: 'app2',
    note: 'lets hire her',
  },
};

class MockDatastore {
  constructor(data) {
    this.data = data;
  };

  index(doc) {
    this.data[doc._id] = doc;
  }

  unindex(id) {
    delete this.data[id];
  }

  get(id) {
    return this.data[id];
  }
}

describe("Test Augmented Datastore", function () {

  describe('Test mock datastore', function () {
    const mockDatastore = new MockDatastore({});
    it("index should create document in mock datastore", function () {
      mockDatastore.index({
        _id: '555',
        hello: 'world',
      });
      const retrievedDoc = mockDatastore.get('555');
      expect(retrievedDoc).to.be.defined;
      expect(get(retrievedDoc, 'hello')).to.deep.equal('world');
    });

    it("unindex should remove document in mock datastore", function () {
      mockDatastore.unindex('555');
      const retrievedDoc2 = mockDatastore.get('555');
      expect(retrievedDoc2).to.not.be.defined;
    });
  });

  describe('ADS with no fragments', function () {
    const mockDatastore = new MockDatastore({});
    const ads = createAugmentedDatastore(mockDatastore);

    it("ADS index should create document in destination datastore", function () {
      ads.index('app1');
      const retrievedDoc = mockDatastore.get('app1');
      expect(retrievedDoc).to.be.defined;
    });

    it("ADS unindex should remove document in destination datastore", function () {
      ads.unindex('app1');
      const retrievedDoc = mockDatastore.get('app1');
      expect(retrievedDoc).to.not.be.defined;
    });
  });

  describe('ADS with fragments', function () {
    const mockDatastore = new MockDatastore({});
    const ads = createAugmentedDatastore(mockDatastore).withFragment({
      id: 'status',
      init: noop,
      buildFragment: function(id) {
        const sourceApplicationDoc = get(sourceDataApplication, id);
        return get(sourceApplicationDoc, 'status');
      },
      onMessage: function(message) {
        const {type, applicationId} = message;
        if (type === 'statusUpdated') {
          return {
            ids: [applicationId],
            action: ACTION_TYPE_UPDATE_FRAGMENT,
          }
        }
      }
    }).withFragment({
      id: 'notes',
      init: noop,
      buildFragment: function(id) {
        return filter(sourceDataNotes, (note) => {
          return get(note, 'applicationId') === id;
        });
      },
      onMessage: noop,
    }).init();

    it("ADS index should create document in destination datastore", function () {
      ads.index('app1');
      const retrievedDoc = mockDatastore.get('app1');
      expect(retrievedDoc).to.be.defined;
      console.log(retrievedDoc);
      expect(get(retrievedDoc, 'status')).to.deep.equal(1);
      const notes = get(retrievedDoc, 'notes');
      expect(notes).to.be.defined;
      expect(size(notes)).to.deep.equal(1);
    });

    it("ADS index should create a second document in destination datastore", function () {
      ads.index('app2');
      const retrievedDoc = mockDatastore.get('app2');
      expect(retrievedDoc).to.be.defined;
      console.log(retrievedDoc);
      expect(get(retrievedDoc, 'status')).to.deep.equal(1);
      const notes = get(retrievedDoc, 'notes');
      expect(notes).to.be.defined;
      expect(size(notes)).to.deep.equal(2);
      expect(size(mockDatastore.data)).to.deep.equal(2);
    });

    it("onMessage handler should trigger fragment update", function () {
      const updatedStatus = 5;
      // update source
      set(sourceDataApplication, 'app1.status', updatedStatus);
      ads.onMessage({
        type: 'statusUpdated',
        applicationId: 'app1',
      });

      const retrievedDoc = mockDatastore.get('app1');
      expect(retrievedDoc).to.be.defined;
      console.log(retrievedDoc);
      expect(get(retrievedDoc, 'status')).to.deep.equal(updatedStatus);
    });

  });
});
