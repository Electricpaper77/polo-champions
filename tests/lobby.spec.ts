import { expect, test } from "@playwright/test";

test("mock platform authentication populates the profile header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("KING'S CUP ARENA")).toBeVisible();
  await expect(page.getByText("LIVE PLAYER STATS")).toBeVisible();
});

test("quick match queue transitions to the verified 2v2 pitch", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ENTER KING'S CUP" }).click();
  await expect(page.getByRole("status")).toContainText("SEARCHING FOR MATCH");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("CHUKKER 1", { exact: true })).toBeVisible();
});

test("private room code lobby supports create join ready and rejects invalid codes", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const profile = JSON.stringify({ hasCompletedTutorial:true });
  await host.addInitScript(value => localStorage.setItem("polo-champions-player-profile", String(value)), profile);
  await guest.addInitScript(value => localStorage.setItem("polo-champions-player-profile", String(value)), profile);
  await host.goto("/");
  await guest.goto("/");

  await host.getByRole("button", { name: "PRIVATE ROOM" }).click();
  await expect(host.getByText(/PRIVATE ROOM · CONNECTED/)).toBeVisible({ timeout: 5_000 });
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  const hostTitle = host.locator(".lobby-modal strong");
  await expect(hostTitle).toHaveText(/ROOM [A-Z0-9]{6}/, { timeout: 5_000 });
  const codeText = await hostTitle.innerText();
  const code = codeText.replace("ROOM ", "").trim();

  await guest.getByRole("button", { name: "PRIVATE ROOM" }).click();
  await expect(guest.getByText(/PRIVATE ROOM · CONNECTED/)).toBeVisible({ timeout: 5_000 });
  await guest.getByRole("button", { name: "SCARLET WOLVES" }).click();
  await guest.getByLabel("ROOM CODE").fill("BAD999");
  await guest.getByRole("button", { name: "JOIN ROOM" }).click();
  await expect(guest.getByRole("alert")).toContainText("Invalid room code");

  await guest.getByLabel("ROOM CODE").fill(code);
  await guest.getByRole("button", { name: "JOIN ROOM" }).click();
  await expect(guest.getByText(`ROOM ${code}`)).toBeVisible();
  await expect(host.getByText("POLO_RED")).toBeVisible({ timeout: 5_000 });
  await expect(guest.getByText("POLO_BLUE")).toBeVisible();

  await host.getByRole("button", { name: "MARK READY" }).click();
  await expect(guest.getByText(/POLO_BLUE.*READY/)).toBeVisible();
  await guest.getByRole("button", { name: "MARK READY" }).click();
  await expect(host.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator("canvas")).toBeVisible({ timeout: 10_000 });

  await host.close();
  await guest.close();
});
