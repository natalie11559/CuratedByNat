// @ts-check
// Small conveniences for Studio's pages. Every page works without this file; it only adds things a form can't do,
// like copying a link to the clipboard. It carries no addresses or data: those come from the page itself.

document.documentElement.classList.add('st-js');

/** @param {string} text */
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const box = document.createElement('textarea');
        box.value = text;
        box.setAttribute('readonly', '');
        box.style.position = 'fixed';
        box.style.opacity = '0';
        document.body.appendChild(box);
        box.select();
        const copied = document.execCommand('copy');
        box.remove();
        return copied;
    }
}

document.addEventListener('click', async (event) => {
    const target = /** @type {Element | null} */ (event.target instanceof Element ? event.target : null);
    const button = target?.closest('[data-copy-from]');
    if (!button) return;

    const source = document.getElementById(button.getAttribute('data-copy-from') ?? '');
    const text = source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement ? source.value : (source?.textContent ?? '');
    const status = document.getElementById(button.getAttribute('data-copy-status') ?? '');

    const copied = text ? await copyText(text) : false;
    if (status) status.textContent = copied ? 'Copied.' : "Couldn't copy. Press and hold the text to copy it.";
    if (source instanceof HTMLInputElement) source.select();
});
