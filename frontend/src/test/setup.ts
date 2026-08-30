// SPDX-License-Identifier: AGPL-3.0-only
import "@testing-library/jest-dom/vitest";

// jsdom shares one URL across tests; hash-router tests must start clean.
beforeEach(() => {
  window.location.hash = "";
  window.history.replaceState(null, "", "/");
});
