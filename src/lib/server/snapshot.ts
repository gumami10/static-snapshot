import sanitizeHtml from 'sanitize-html';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MAX_CSS_CHARS = 2 * 1024 * 1024;

const CSP = [
	"default-src 'none'",
	'base-uri http: https:',
	"script-src 'none'",
	"style-src 'unsafe-inline' http: https:",
	'img-src http: https: data:',
	'font-src http: https: data:',
	'media-src http: https: data:',
	"form-action 'none'",
	"frame-src 'none'"
].join('; ');

const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
	'style',
	'form',
	'label',
	'fieldset',
	'legend',
	'input',
	'button',
	'select',
	'datalist',
	'optgroup',
	'option',
	'textarea',
	'output',
	'progress',
	'meter',
	'details',
	'summary',
	'dialog',
	'picture',
	'source',
	'video',
	'audio',
	'track',
	'canvas',
	'ins',
	'del',
	'font',
	'center',
	'big',
	'tt',
	'strike'
]);

const ALLOWED_ATTRIBUTES = [
	'id',
	'class',
	'style',
	'title',
	'lang',
	'dir',
	'role',
	'hidden',
	'tabindex',
	'href',
	'target',
	'rel',
	'download',
	'hreflang',
	'media',
	'type',
	'src',
	'srcset',
	'sizes',
	'alt',
	'width',
	'height',
	'loading',
	'decoding',
	'referrerpolicy',
	'name',
	'value',
	'placeholder',
	'checked',
	'disabled',
	'readonly',
	'required',
	'multiple',
	'selected',
	'for',
	'form',
	'list',
	'size',
	'maxlength',
	'minlength',
	'min',
	'max',
	'step',
	'pattern',
	'autocomplete',
	'rows',
	'cols',
	'wrap',
	'open',
	'start',
	'reversed',
	'datetime',
	'cite',
	'span',
	'colspan',
	'rowspan',
	'headers',
	'scope',
	'controls',
	'loop',
	'muted',
	'poster',
	'preload',
	'playsinline',
	'align',
	'valign',
	'border',
	'cellpadding',
	'cellspacing',
	'bgcolor',
	'color',
	'face',
	'aria-*',
	'data-*'
];

const LINK_TAG = /<link\b[^>]*>/gi;
const CSS_URL_TOKEN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT = /(@import\s+)(['"])([^'"]+)\2/gi;

export class SnapshotError extends Error {
	constructor(
		message: string,
		readonly status = 502
	) {
		super(message);
		this.name = 'SnapshotError';
	}
}

function isPrivateIp(ip: string): boolean {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	if (isIP(ip) === 6) {
		const value = ip.toLowerCase();
		if (value.startsWith('::ffff:')) return isPrivateIp(value.slice(7));
		return (
			value === '::1' ||
			value === '::' ||
			value.startsWith('fc') ||
			value.startsWith('fd') ||
			/^fe[89a-f]/.test(value)
		);
	}
	return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal')
	) {
		throw new SnapshotError('Blocked: local hostnames are not allowed', 403);
	}
	if (isIP(host)) {
		if (isPrivateIp(host)) throw new SnapshotError('Blocked: private network address', 403);
		return;
	}
	let addresses: { address: string }[];
	try {
		addresses = await lookup(host, { all: true, verbatim: true });
	} catch {
		throw new SnapshotError(`Could not resolve host: ${host}`, 502);
	}
	if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
		throw new SnapshotError('Blocked: host resolves to a private network address', 403);
	}
}

function getAttribute(tag: string, name: string): string | null {
	const match = tag.match(
		new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
	);
	return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function rewriteCssUrls(css: string, baseUrl: string): string {
	const rewritten = css.replace(CSS_URL_TOKEN, (match, quote: string, value: string) => {
		if (/^(data:|blob:|about:|#)/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
			return match;
		}
		try {
			return `url(${quote || '"'}${new URL(value, baseUrl).href}${quote || '"'})`;
		} catch {
			return match;
		}
	});
	return rewritten.replace(CSS_IMPORT, (match, prefix: string, quote: string, value: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return match;
		try {
			return `${prefix}${quote}${new URL(value, baseUrl).href}${quote}`;
		} catch {
			return match;
		}
	});
}

function toStyleTag(css: string): string {
	return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
}

async function fetchStylesheet(url: string): Promise<string | null> {
	try {
		await assertPublicHost(new URL(url).hostname);
		const response = await fetch(url, {
			headers: { 'user-agent': USER_AGENT, accept: 'text/css,*/*;q=0.1' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!response.ok) return null;
		const declared = Number(response.headers.get('content-length') ?? Number.NaN);
		if (Number.isFinite(declared) && declared > MAX_CSS_CHARS) return null;
		const css = await response.text();
		return css.length > MAX_CSS_CHARS ? null : css;
	} catch {
		return null;
	}
}

async function inlineStylesheets(html: string, pageUrl: string): Promise<string> {
	const replacements = new Map<string, string | null>();
	const pending: Promise<void>[] = [];

	for (const tag of html.match(LINK_TAG) ?? []) {
		const rel = getAttribute(tag, 'rel');
		const href = getAttribute(tag, 'href');
		if (!rel || !/\bstylesheet\b/i.test(rel) || !href || /^(data:|javascript:)/i.test(href)) {
			continue;
		}
		if (replacements.has(tag)) continue;

		let cssUrl: string;
		try {
			cssUrl = new URL(href, pageUrl).href;
		} catch {
			continue;
		}

		replacements.set(tag, null);
		pending.push(
			fetchStylesheet(cssUrl).then((css) => {
				replacements.set(tag, css ? toStyleTag(rewriteCssUrls(css, cssUrl)) : null);
			})
		);
	}

	await Promise.all(pending);

	return html.replace(LINK_TAG, (tag) => replacements.get(tag) ?? tag);
}

function sanitize(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: { '*': ALLOWED_ATTRIBUTES },
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: {
			img: ['http', 'https', 'data'],
			source: ['http', 'https', 'data'],
			video: ['http', 'https'],
			audio: ['http', 'https'],
			track: ['http', 'https'],
			a: ['http', 'https', 'mailto', 'tel']
		},
		allowProtocolRelative: false,
		allowVulnerableTags: true,
		disallowedTagsMode: 'discard'
	});
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function assembleDocument(body: string, baseUrl: string): string {
	return [
		'<!DOCTYPE html>',
		'<html><head>',
		'<meta charset="utf-8">',
		`<base href="${escapeAttribute(baseUrl)}">`,
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(CSP)}">`,
		'</head><body>',
		body,
		'</body></html>'
	].join('');
}

export async function fetchStaticSnapshot(target: string): Promise<string> {
	let pageUrl: URL;
	try {
		pageUrl = new URL(target);
	} catch {
		throw new SnapshotError('Invalid URL', 400);
	}
	if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
		throw new SnapshotError('Only http and https URLs are supported', 400);
	}
	await assertPublicHost(pageUrl.hostname);

	let response: Response;
	try {
		response = await fetch(pageUrl, {
			headers: {
				'user-agent': USER_AGENT,
				accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			redirect: 'follow'
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'unknown error';
		throw new SnapshotError(`Fetch failed: ${reason}`, 502);
	}
	if (!response.ok) {
		throw new SnapshotError(`Upstream responded with HTTP ${response.status}`, 502);
	}

	let finalUrl = pageUrl;
	try {
		finalUrl = new URL(response.url || pageUrl.href);
	} catch {
		finalUrl = pageUrl;
	}
	if (finalUrl.hostname !== pageUrl.hostname) {
		await assertPublicHost(finalUrl.hostname);
	}

	const declared = Number(response.headers.get('content-length') ?? Number.NaN);
	if (Number.isFinite(declared) && declared > MAX_HTML_CHARS) {
		throw new SnapshotError('Page exceeds size limit', 502);
	}
	const html = await response.text();
	if (html.length > MAX_HTML_CHARS) {
		throw new SnapshotError('Page exceeds size limit', 502);
	}

	const withStyles = await inlineStylesheets(html, finalUrl.href);
	return assembleDocument(sanitize(withStyles), finalUrl.href);
}
