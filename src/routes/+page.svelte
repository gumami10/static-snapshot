<script lang="ts">
	let url = $state('');
	let document = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const target = url.trim();
		if (!target) return;

		loading = true;
		error = '';
		document = '';

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
		</form>
		<p class="hint">
			Fetches HTML + CSS server-side, strips all JavaScript, renders in a sandboxed frame.
		</p>
	</header>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if document}
		<iframe
			class="preview"
			sandbox=""
			referrerpolicy="no-referrer"
			srcdoc={document}
			title="Static snapshot preview"
		></iframe>
	{/if}
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

	.preview {
		flex: 1;
		min-height: 0;
		width: 100%;
		border: 0;
		background: #fff;
	}
</style>
