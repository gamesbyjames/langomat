import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App';

// Mock fetch to provide test data
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve(`
# Test Section
Hello world | Hello World
Goodbye world | Goodbye World
How are you | How are you?
`),
  })
);

beforeEach(() => {
  fetch.mockClear();
  // Mock process.env
  process.env.PUBLIC_URL = '';
});

test('renders app with language learning game title', async () => {
  render(<App />);
  
  await waitFor(() => {
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });
  
  const title = screen.getByText(/Language Learning Game/i);
  expect(title).toBeInTheDocument();
});

test('back button functionality in sequential mode', async () => {
  render(<App />);
  
  // Wait for app to load
  await waitFor(() => {
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });
  
  // Select the Demo section (which is what actually loads due to fallback)
  const sectionButton = await screen.findByText('Demo');
  fireEvent.click(sectionButton);
  
  // Should be in game mode now
  await waitFor(() => {
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
  
  // Initially, previous button should be disabled (at first phrase)
  const previousButton = screen.getByRole('button', { name: /previous phrase/i });
  const nextButton = screen.getByRole('button', { name: /next phrase/i });
  
  expect(previousButton).toBeDisabled();
  expect(nextButton).not.toBeDisabled();
  
  // Click next to move forward
  fireEvent.click(nextButton);
  
  // Now previous button should be enabled
  await waitFor(() => {
    expect(previousButton).not.toBeDisabled();
  });
  
  // Click previous to go back
  fireEvent.click(previousButton);
  
  // Should be back at first phrase, previous button disabled again
  await waitFor(() => {
    expect(previousButton).toBeDisabled();
  });
});

test('back button functionality in random mode', async () => {
  render(<App />);
  
  // Wait for app to load
  await waitFor(() => {
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });
  
  // Select the Demo section first
  const sectionButton = await screen.findByText('Demo');
  fireEvent.click(sectionButton);
  
  // Should be in game mode now
  await waitFor(() => {
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
  
  // Now enable random mode (the checkbox should be visible in game mode)
  const randomCheckbox = screen.getByRole('checkbox');
  if (!randomCheckbox.checked) {
    fireEvent.click(randomCheckbox); // Enable random mode if not already enabled
  }
  
  // In random mode, previous button should initially be disabled (no history)
  const previousButton = screen.getByRole('button', { name: /previous phrase/i });
  const nextButton = screen.getByRole('button', { name: /next phrase/i });
  
  expect(previousButton).toBeDisabled();
  expect(nextButton).not.toBeDisabled();
  
  // Click next to build some history
  fireEvent.click(nextButton);
  
  // Now previous button should be enabled (we have history)
  await waitFor(() => {
    expect(previousButton).not.toBeDisabled();
  });
  
  // Click previous to use the history
  fireEvent.click(previousButton);
  
  // Previous button should be disabled again (back to start of history)
  await waitFor(() => {
    expect(previousButton).toBeDisabled();
  });
});
