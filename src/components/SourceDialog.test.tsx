import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JURISDICTION_SOURCE } from '../data/jurisdictions';
import { providerMetadata } from '../data/providers';
import { CATEGORY_LABELS } from '../domain/categories';
import { SourceDialog } from './SourceDialog';

const CHICAGO = providerMetadata.find((provider) => provider.id === 'chicago')!;

/** jsdom has no layout; the trap only cycles through elements with client rects. */
function giveElementsLayout() {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => ({ length: 1, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList,
  );
}

function focusables(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
}

async function openDialog(onClose = vi.fn(), activeProvider: typeof CHICAGO | null = CHICAGO) {
  const view = render(<SourceDialog activeProvider={activeProvider} onClose={onClose} open />);
  const dialog = screen.getByRole('dialog', { name: 'Sources & methodology' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close sources and methodology' })).toHaveFocus());
  return { ...view, dialog, onClose };
}

describe('SourceDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<SourceDialog activeProvider={CHICAGO} onClose={vi.fn()} open={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement).not.toHaveClass('has-open-dialog');
  });

  it('opens as a described modal and focuses the close button', async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/compares the selected circle with its immediately surrounding area/);
    expect(document.documentElement).toHaveClass('has-open-dialog');
  });

  it('explains the method, weights and limitations', async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole('img', {
      name: 'Relative activity equals selected weighted incidents per covered selected square kilometer divided by '
        + 'nearby weighted incidents per covered annulus square kilometer',
    })).toBeInTheDocument();
    expect(within(dialog).getByText('selected weighted incidents / covered selected km²')).toBeInTheDocument();
    expect(within(dialog).getByText('nearby weighted incidents / covered annulus km²')).toBeInTheDocument();
    const callout = within(dialog).getByText('Transparent local comparison').closest('div')!;
    expect(callout).toHaveTextContent(`Coverage follows each city's legal limits (${JURISDICTION_SOURCE.source})`);
    expect(callout).toHaveTextContent('are left out of every density');
    for (const label of Object.values(CATEGORY_LABELS)) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('5.0×')).toBeInTheDocument();
    expect(within(dialog).getByText('1.3×')).toBeInTheDocument();
    const limitations = within(dialog).getByRole('heading', { name: 'Read these limitations before acting' }).closest('section')!;
    expect(within(limitations).getAllByRole('listitem')).toHaveLength(6);
    expect(within(dialog).getByTestId('fbi-method')).toHaveTextContent('FBI Crime Data Explorer');
    expect(within(dialog).getByTestId('fbi-method')).toHaveTextContent('else the county sheriff or county police');
  });

  it('closes with the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Close sources and methodology' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and ignores other keys', async () => {
    const user = userEvent.setup();
    const { onClose } = await openDialog();

    await user.keyboard('a');
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a backdrop press but not on a press inside the dialog', async () => {
    const { dialog, onClose } = await openDialog();

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps Tab and Shift+Tab focus within the dialog', async () => {
    giveElementsLayout();
    const { dialog } = await openDialog();
    const elements = focusables(dialog);
    const first = elements[0]!;
    const last = elements.at(-1)!;
    expect(first).toHaveFocus();

    last.focus();
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    expect(first).toHaveFocus();

    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();

    elements[1]!.focus();
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(elements[1]).toHaveFocus();
  });

  it('pulls focus back into the dialog when it has escaped', async () => {
    giveElementsLayout();
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.append(outside);
    const { dialog } = await openDialog();
    const elements = focusables(dialog);

    outside.focus();
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    expect(elements[0]).toHaveFocus();

    outside.focus();
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(elements.at(-1)).toHaveFocus();
    outside.remove();
  });

  it('leaves Tab alone when nothing in the dialog is visible', async () => {
    await openDialog();
    // Without layout every element is filtered out as invisible.
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true);
  });

  it('lists the active provider first and every other publisher after it', async () => {
    const { dialog } = await openDialog();

    const current = within(dialog).getByRole('heading', { name: 'Current source' }).closest('section')!;
    expect(within(current).getAllByRole('article')).toHaveLength(1);
    expect(within(current).getByRole('article')).toHaveClass('is-active');
    expect(within(current).getByRole('heading', { name: CHICAGO.datasetName })).toBeInTheDocument();
    expect(current).toHaveTextContent(CHICAGO.agency);
    expect(current).toHaveTextContent(`${CHICAGO.cadence}. ${CHICAGO.delayNote}`);
    expect(current).toHaveTextContent(`Field contract verified ${CHICAGO.lastVerified}`);

    const others = within(dialog).getByRole('heading', { name: 'Other official local publishers' }).closest('section')!;
    const cards = within(others).getAllByRole('article');
    expect(cards).toHaveLength(providerMetadata.length - 1);
    expect(others).not.toHaveTextContent(CHICAGO.datasetName);
    expect(within(dialog).getAllByRole('link', { name: /^Open / })).toHaveLength(providerMetadata.length);
  });

  it('lists every publisher when the place has no active provider', async () => {
    const { dialog } = await openDialog(vi.fn(), null);

    expect(within(dialog).queryByRole('heading', { name: 'Current source' })).not.toBeInTheDocument();
    const all = within(dialog).getByRole('heading', { name: 'Official local publishers' }).closest('section')!;
    expect(within(all).getAllByRole('article')).toHaveLength(providerMetadata.length);
    const link = within(all).getByRole('link', { name: `Open ${CHICAGO.datasetName}` });
    expect(link).toHaveAttribute('href', CHICAGO.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('restores focus to the opener and stops listening when closed', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open sources';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(<SourceDialog activeProvider={CHICAGO} onClose={onClose} open />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close sources and methodology' })).toHaveFocus());

    rerender(<SourceDialog activeProvider={CHICAGO} onClose={onClose} open={false} />);

    expect(opener).toHaveFocus();
    expect(document.documentElement).not.toHaveClass('has-open-dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    opener.remove();
  });
});
