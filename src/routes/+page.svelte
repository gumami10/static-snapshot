<script lang="ts">
	import { browser } from '$app/env';
	import {
		deleteSnapshot,
		getSnapshot,
		listSnapshots,
		saveSnapshot,
		type SnapshotMeta
	} from '#lib/saved.ts';

	let url = $state('');
	let document = $state('');
	let error = $state('');
	let loading = $state(false);

	let snapshots = $state<SnapshotMeta[]>([]);
	let activeId = $state<string | null>(null);
	let savedId = $state<string | null>(null);
	let saving = $state(false);

	$effect(() => {
		if (browser) void refreshLibrary();
	});

	async function refreshLibrary() {
		try {
			snapshots = await listSnapshots();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	function displayHost(value: string): string {
		try {
			return new URL(value).hostname;
		} catch {
			return value;
		}
	}

	function titleFor(html: string, fallback: string): string {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		return parsed.title.trim() || fallback;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(savedAt: number): string {
		return new Date(savedAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const target = url.trim();
		if (!target) return;

		loading = true;
		error = '';
		document = '';
		activeId = null;
		savedId = null;

		try {
			const normalized = /^https?:\/\//i.test(target) ? target : `https://${target}`;
			const response = await fetch(`/api/fetch?url=${encodeURIComponent(normalized)}`);
			if (!response.ok) {
				throw new Error((await response.text()) || `Request failed (HTTP ${response.status})`);
			}
			document = await response.text();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function handleSave() {
		if (!document || saving || savedId) return;
		saving = true;
		error = '';

		try {
			const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
			const meta = await saveSnapshot({
				url: normalized,
				title: titleFor(document, displayHost(normalized)),
				html: document
			});
			savedId = meta.id;
			await refreshLibrary();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	async function openSaved(meta: SnapshotMeta) {
		error = '';
		try {
			const html = await getSnapshot(meta.id);
			if (html === null) {
				error = 'Saved snapshot no longer exists';
				await refreshLibrary();
				return;
			}
			document = html;
			url = meta.url;
			activeId = meta.id;
			savedId = meta.id;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function removeSaved(id: string) {
		error = '';
		try {
			await deleteSnapshot(id);
			if (activeId === id) activeId = null;
			if (savedId === id) savedId = null;
			await refreshLibrary();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<svelte:head>
	<title>Static Snapshot — HTML + CSS, no JavaScript</title>
</svelte:head>

<div class="shell">
	<header>
		<form onsubmit={handleSubmit}>
			<input
				type="text"
				bind:value={url}
				placeholder="example.com"
				aria-label="Page URL"
				autocomplete="off"
				spellcheck="false"
			/>
			<button type="submit" disabled={loading}>
				{loading ? 'Fetching…' : 'Snapshot'}
			</button>
			<button
				type="button"
				class="secondary"
				onclick={handleSave}
				disabled={!document || saving || savedId !== null}
			>
				{saving ? 'Saving…' : savedId ? 'Saved' : 'Save'}
			</button>
		</form>
		<p class="hint">
			Fetches HTML + CSS server-side, strips all JavaScript, renders in a sandboxed frame. Saved
			snapshots stay in this browser until you delete them.
		</p>
	</header>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<div class="body">
		<aside class="library">
			<h2>Library</h2>
			{#if snapshots.length === 0}
				<p class="empty">No saved snapshots yet.</p>
			{:else}
				<ul>
					{#each snapshots as meta (meta.id)}
						<li class:active={meta.id === activeId}>
							<button class="open" onclick={() => openSaved(meta)}>
								<span class="entry-title">{meta.title}</span>
								<span class="entry-meta">
									{displayHost(meta.url)} · {formatDate(meta.savedAt)} · {formatBytes(meta.bytes)}
								</span>
							</button>
							<button
								class="remove"
								onclick={() => removeSaved(meta.id)}
								aria-label="Delete {meta.title}"
							>
								Delete
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>

		<main class="viewer">
			{#if document}
				<iframe
					class="preview"
					sandbox=""
					referrerpolicy="no-referrer"
					srcdoc={document}
					title="Static snapshot preview"
				></iframe>
			{:else}
				<p class="placeholder">Fetch a page above to preview it here.</p>
			{/if}
		</main>
	</div>
</div>

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
	}

	:global(body) {
		font-family: system-ui, sans-serif;
		background: #f4f4f5;
		color: #18181b;
	}

	.shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.75rem 1rem;
		background: #18181b;
		color: #fafafa;
	}

	form {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		min-width: 16rem;
	}

	input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid #3f3f46;
		border-radius: 6px;
		background: #27272a;
		color: inherit;
		font: inherit;
	}

	input:focus {
		outline: 2px solid #818cf8;
		outline-offset: 1px;
	}

	button {
		padding: 0.5rem 1rem;
		border: 0;
		border-radius: 6px;
		background: #6366f1;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	button.secondary {
		background: #3f3f46;
	}

	button.secondary:disabled {
		cursor: default;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: #a1a1aa;
	}

	.error {
		margin: 0;
		padding: 0.75rem 1rem;
		background: #fef2f2;
		color: #b91c1c;
		border-bottom: 1px solid #fecaca;
	}

	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.library {
		display: flex;
		flex-direction: column;
		width: 18rem;
		flex-shrink: 0;
		border-right: 1px solid #e4e4e7;
		background: #fafafa;
		overflow-y: auto;
	}

	.library h2 {
		margin: 0;
		padding: 0.75rem 1rem 0.25rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #71717a;
	}

	.library ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.library li {
		display: flex;
		align-items: stretch;
		border-top: 1px solid #e4e4e7;
	}

	.library li.active {
		background: #eef2ff;
	}

	.open {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
		padding: 0.6rem 0.75rem;
		border: 0;
		border-radius: 0;
		background: none;
		color: inherit;
		text-align: left;
		font-weight: 400;
		cursor: pointer;
	}

	.open:hover {
		background: #f4f4f5;
	}

	.entry-title {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.entry-meta {
		font-size: 0.75rem;
		color: #71717a;
	}

	.remove {
		border: 0;
		border-radius: 0;
		background: none;
		color: #a1a1aa;
		font-size: 0.75rem;
		font-weight: 400;
		padding: 0 0.75rem;
		cursor: pointer;
	}

	.remove:hover {
		color: #b91c1c;
	}

	.empty {
		margin: 0;
		padding: 0 1rem;
		font-size: 0.85rem;
		color: #71717a;
	}

	.viewer {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.preview {
		flex: 1;
		min-height: 0;
		width: 100%;
		border: 0;
		background: #fff;
	}

	.placeholder {
		margin: auto;
		color: #71717a;
		font-size: 0.9rem;
	}

	@media (max-width: 640px) {
		.body {
			flex-direction: column-reverse;
		}

		.library {
			width: auto;
			max-height: 40%;
			border-right: 0;
			border-top: 1px solid #e4e4e7;
		}
	}
</style>
