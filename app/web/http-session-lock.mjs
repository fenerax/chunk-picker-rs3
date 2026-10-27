// IndexedDB transactions provide atomic ownership on private HTTP, where Web
// Locks are unavailable. Never expire ownership: a suspended tab may still save.
// A crash can leave a stale lock; Check History / Discard starts a fresh session.
export function acquireHttpSession(clientId, indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('picker.command-ownership.v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('owners');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      const transaction = db.transaction('owners', 'readwrite');
      transaction.objectStore('owners').add(true, clientId);
      transaction.onabort = () => {
        db.close();
        if (transaction.error?.name === 'ConstraintError') resolve(null);
        else reject(transaction.error);
      };
      transaction.oncomplete = () => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const release = db.transaction('owners', 'readwrite');
          release.objectStore('owners').delete(clientId);
          release.oncomplete = release.onabort = () => db.close();
        });
      };
    };
  });
}
