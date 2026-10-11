import type { RequestHandler } from './$types';
import { fetchStaticSnapshot, SnapshotError } from '#lib/server/snapshot.ts';

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) {
		return new Response('Missing ?url= parameter', { status: 400 });
	}

	try {
		const document = await fetchStaticSnapshot(target);
		return new Response(document, {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store'
			}
		});
	} catch (error) {
		if (error instanceof SnapshotError) {
			return new Response(error.message, { status: error.status });
		}
		console.error(error);
		return new Response('Unexpected error while building snapshot', { status: 500 });
	}
};
