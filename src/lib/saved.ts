export type SnapshotMeta = {
	id: string;
	url: string;
	title: string;
	savedAt: number;
	bytes: number;
};

const DB_NAME = 'snapshot-library';
const DB_VERSION = 1;
const META_STORE = 'meta';
const PAGE_STORE = 'pages';

let dbPromise: Promise<IDBDatabase> | null = null;

function createDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
			}
			if (!db.objectStoreNames.contains(PAGE_STORE)) {
				db.createObjectStore(PAGE_STORE, { keyPath: 'id' });
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = () =>
			reject(request.error ?? new Error('Could not open the snapshot database'));
		request.onblocked = () => reject(new Error('Snapshot database is blocked by another tab'));
	});
}

function openDatabase(): Promise<IDBDatabase> {
	dbPromise ??= createDatabase().catch((error) => {
		dbPromise = null;
		throw error;
	});
	return dbPromise;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
	const db = await openDatabase();
	const store = db.transaction(META_STORE, 'readonly').objectStore(META_STORE);
	const metas = await requestDone<SnapshotMeta[]>(store.index('savedAt').getAll());
	return metas.reverse();
}

export async function getSnapshot(id: string): Promise<string | null> {
	const db = await openDatabase();
	const store = db.transaction(PAGE_STORE, 'readonly').objectStore(PAGE_STORE);
	const record = await requestDone<{ id: string; html: string } | undefined>(store.get(id));
	return record?.html ?? null;
}

export async function saveSnapshot(input: {
	url: string;
	title: string;
	html: string;
}): Promise<SnapshotMeta> {
	const db = await openDatabase();
	const meta: SnapshotMeta = {
		id: crypto.randomUUID(),
		url: input.url,
		title: input.title,
		savedAt: Date.now(),
		bytes: new Blob([input.html]).size
	};

	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([META_STORE, PAGE_STORE], 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error('Save aborted — storage may be full'));
		tx.onerror = () => reject(tx.error ?? new Error('Save failed'));
		tx.objectStore(META_STORE).put(meta);
		tx.objectStore(PAGE_STORE).put({ id: meta.id, html: input.html });
	});

	return meta;
}

export async function deleteSnapshot(id: string): Promise<void> {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([META_STORE, PAGE_STORE], 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error('Delete aborted'));
		tx.onerror = () => reject(tx.error ?? new Error('Delete failed'));
		tx.objectStore(META_STORE).delete(id);
		tx.objectStore(PAGE_STORE).delete(id);
	});
}
