import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, MemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Badge, Chip } from './Chip';
import { EmptyState } from './EmptyState';
import { GroupedList, Section } from './GroupedList';
import { buttonClasses } from './buttonClasses';
import { IconButton } from './IconButton';
import { ListRow } from './ListRow';
import { PageHeader } from './PageHeader';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Sheet } from './Sheet';
import { TextArea } from './TextArea';
import { TextField } from './TextField';
import { Toast } from './Toast';
import { Toggle } from './Toggle';
import DesignKitPage from './DesignKitPage';

describe('Button', () => {
  it('runs onClick and defaults to type="button"', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading keeps the label, sets aria-busy and blocks clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('buttonClasses (Task 11.U2)', () => {
  it('a small button is a 44 px target on touch screens', () => {
    render(<Button size="sm">Undo</Button>);
    expect(screen.getByRole('button', { name: 'Undo' }).className).toContain(
      'pointer-coarse:min-h-11',
    );
  });

  it('gives a link the same look as a Button', () => {
    render(<button className={buttonClasses('primary', 'md')}>Same</button>);
    render(<Button variant="primary">Real</Button>);
    expect(screen.getByRole('button', { name: 'Same' }).className).toBe(
      screen.getByRole('button', { name: 'Real' }).className,
    );
  });

  it('a Section can be named for screen readers', () => {
    render(
      <Section title="Ideas" label="Ideas from Scout">
        <p>x</p>
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Ideas from Scout' })).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('is named by its label', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="close" label="Close" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Chip and Badge', () => {
  it('a chip with onClick is a toggle button with aria-pressed', async () => {
    function Filter() {
      const [on, setOn] = useState(false);
      return (
        <Chip selected={on} onClick={() => setOn(!on)}>
          Work
        </Chip>
      );
    }
    render(<Filter />);
    const chip = screen.getByRole('button', { name: 'Work' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('a plain chip is just text', () => {
    render(<Chip tone="accent">This device</Chip>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
  });

  it('badge hides at zero and caps at 99+', () => {
    const { rerender } = render(<Badge count={0} />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
    rerender(<Badge count={150} />);
    expect(screen.getByTestId('badge')).toHaveTextContent('99+');
    expect(screen.getByTestId('badge')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SegmentedControl', () => {
  function View() {
    const [value, setValue] = useState<'day' | 'week' | 'month'>('week');
    return (
      <SegmentedControl
        label="View"
        value={value}
        onChange={setValue}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
    );
  }

  it('is a radio group with the selected option checked and tabbable', () => {
    render(<View />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    const week = within(group).getByRole('radio', { name: 'Week' });
    expect(week).toHaveAttribute('aria-checked', 'true');
    expect(week).toHaveAttribute('tabindex', '0');
    expect(within(group).getByRole('radio', { name: 'Day' })).toHaveAttribute('tabindex', '-1');
  });

  it('arrow keys, Home and End move and select, wrapping round', async () => {
    render(<View />);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking selects', async () => {
    render(<View />);
    await userEvent.click(screen.getByRole('radio', { name: 'Day' }));
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Sheet', () => {
  function Harness({ onClose = () => {} }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Sheet
          open={open}
          title="New event"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<Button>Save</Button>}
        >
          <TextField label="Title" />
        </Sheet>
      </>
    );
  }

  it('opens as a labelled modal dialog and focuses the first field', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();
  });

  it('Esc closes it and focus returns to the opener', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('the close button and the backdrop close it', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside the sheet', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    // Order in the sheet: Close, Title, Save.
    save.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(save).toHaveFocus();
  });
});

describe('ListRow', () => {
  it('with `to` is a link named by its title', () => {
    render(
      <MemoryRouter>
        <GroupedList label="Settings">
          <ListRow title="Design kit" subtitle="All components" to="/ui" />
        </GroupedList>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Design kit/ });
    expect(link).toHaveAttribute('href', '/ui');
    expect(
      within(screen.getByRole('list', { name: 'Settings' })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('with onClick is a button; without either it is plain content', async () => {
    const onClick = vi.fn();
    render(
      <GroupedList>
        <ListRow title="Sync now" onClick={onClick} />
        <ListRow title="Version" trailing="1.0" />
      </GroupedList>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('1.0')).toBeInTheDocument();
  });
});

describe('fields', () => {
  it('TextField: label names the input; hint and error describe it', () => {
    render(<TextField label="Email" hint="We never share it." error="Enter an email address." />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('We never share it. Enter an email address.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an email address.');
  });

  it('TextArea and Select are labelled', async () => {
    const onChange = vi.fn();
    render(
      <>
        <TextArea label="Notes" />
        <Select
          label="Calendar"
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: 'a', label: 'Personal' },
            { value: 'b', label: 'Work' },
          ]}
        />
      </>,
    );
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    await userEvent.selectOptions(screen.getByLabelText('Calendar'), 'Work');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('Toggle is a labelled switch', async () => {
    function T() {
      const [on, setOn] = useState(false);
      return <Toggle label="Morning brief" checked={on} onChange={setOn} />;
    }
    render(<T />);
    const sw = screen.getByRole('switch', { name: 'Morning brief' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Toast', () => {
  it('is a status that dismisses itself after its duration', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(<Toast message="Event added" onDismiss={onDismiss} duration={1000} />);
      expect(screen.getByRole('status')).toHaveTextContent('Event added');
      act(() => vi.advanceTimersByTime(999));
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('its action runs and dismisses', async () => {
    const onDismiss = vi.fn();
    const undo = vi.fn();
    render(
      <Toast
        message="Event added"
        onDismiss={onDismiss}
        action={{ label: 'Undo', onClick: undo }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('PageHeader and EmptyState', () => {
  it('renders an h1, a back link and actions', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Lists"
          back={{ to: '/library', label: 'Library' }}
          actions={<IconButton icon="settings" label="Options" />}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument();
  });

  it('EmptyState shows title, message and action', () => {
    render(
      <EmptyState title="Inbox is clear" message="Nothing waiting." action={<Button>Go</Button>} />,
    );
    expect(screen.getByText('Inbox is clear')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
});

describe('Design kit', () => {
  it('shows every component in a light and a dark panel', () => {
    const router = createMemoryRouter([{ path: '/ui', Component: DesignKitPage }], {
      initialEntries: ['/ui'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Design kit' })).toBeInTheDocument();
    for (const name of ['Light', 'Dark']) {
      const panel = screen.getByRole('region', { name });
      expect(panel).toHaveAttribute('data-theme', name.toLowerCase());
      for (const section of [
        'Colours',
        'Type',
        'Buttons',
        'Chips and badges',
        'Segmented control',
        'Grouped list',
        'Fields',
        'Empty state',
        'Sheet and toast',
      ]) {
        expect(within(panel).getByRole('heading', { level: 2, name: section })).toBeInTheDocument();
      }
    }
  });
});
