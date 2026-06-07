/**
 * Svelte action that teleports a DOM element to document.body, letting it
 * escape any overflow:hidden or stacking-context boundary in the component
 * tree. The element is removed from the body when the host component unmounts.
 *
 * Usage: <div use:portal>…</div>
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
