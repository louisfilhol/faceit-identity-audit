// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./Toast";

interface FireToastProps {
  message: string;
  kind?: "" | "good" | "bad" | "busy";
  ms?: number;
}

function FireToast({ message, kind = "", ms }: FireToastProps) {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast(message, kind, ms)}>
        fire
      </button>
    </div>
  );
}

describe("toast notifications", () => {
  it("renders a toast with the message and dismiss button", async () => {
    render(
      <ToastProvider>
        <FireToast message="Configuration saved" kind="good" ms={0} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByText("Configuration saved")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeTruthy();
  });

  it("auto-dismisses after the delay", async () => {
    // Short real delay instead of fake timers: the dismissal path involves
    // both the toast timer and the exit-animation grace period.
    render(
      <ToastProvider>
        <FireToast message="bye" ms={50} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByText("bye")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("bye")).toBeNull(), {
      timeout: 2000,
    });
  });

  it("can be dismissed manually", async () => {
    render(
      <ToastProvider>
        <FireToast message="dismiss me" ms={0} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "fire" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByText("dismiss me")).toBeNull();
  });
});
