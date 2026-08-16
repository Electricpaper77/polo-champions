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
