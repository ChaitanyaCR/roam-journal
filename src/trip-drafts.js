let database;

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("roam-journal-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The draft store is busy."));
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", mode);
    const request = operation(transaction.objectStore("drafts"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const readDraft = key => transact("readonly", store => store.get(key));
export const saveDraft = async (key, draft, previousStamp) => {
  let saved = false;
  await transact("readwrite", store => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.stamp !== previousStamp) return;
      store.put(draft, key);
      saved = true;
    };
    return request;
  });
  return saved;
};
export const clearDraft = (key, stamp) => transact("readwrite", store => {
  const request = store.get(key);
  request.onsuccess = () => {
    if (request.result?.stamp === stamp) store.delete(key);
  };
  return request;
});
