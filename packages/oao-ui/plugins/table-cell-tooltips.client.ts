export default defineNuxtPlugin(() => {
  const selector = '.p-datatable .p-datatable-tbody > tr > td';

  function applyCellTitles(root: ParentNode = document) {
    for (const cell of root.querySelectorAll<HTMLElement>(selector)) {
      const text = cell.innerText.replace(/\s+/g, ' ').trim();
      if (!text || text.length < 24) {
        if (cell.dataset.oaoAutoTitle === 'true') {
          cell.removeAttribute('title');
          delete cell.dataset.oaoAutoTitle;
        }
        continue;
      }

      if (!cell.getAttribute('title') || cell.dataset.oaoAutoTitle === 'true') {
        cell.title = text;
        cell.dataset.oaoAutoTitle = 'true';
      }
    }
  }

  requestAnimationFrame(() => applyCellTitles());

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target instanceof HTMLElement) {
        applyCellTitles(mutation.target);
      } else if (mutation.target.parentElement) {
        applyCellTitles(mutation.target.parentElement);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
});