/**
 * Saves a string to a file, entirely in the browser.
 *
 * No server is involved at any point — the blob is created, handed to a synthetic
 * anchor click, and revoked. This is what "no data leaves the device" means in
 * practice, and it is why export works offline.
 */
export function downloadText(filename: string, contents: string, type = 'application/json') {
	const blob = new Blob([contents], { type });
	const url = URL.createObjectURL(blob);

	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	// Revoke on the next turn: Safari has historically needed the URL to still be live
	// when the click is processed.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readFileAsText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
		reader.readAsText(file);
	});
}
