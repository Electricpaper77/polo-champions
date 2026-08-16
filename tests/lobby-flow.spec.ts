import { expect, test } from "@playwright/test";

test("party ready authorizes the host start and loading enters the 4v4 pitch", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "HOST CUSTOM PARTY" }).click();
  await expect(page.getByText("YOUR PARTY 4/4")).toBeVisible();
  const start = page.getByRole("button", { name: "START MATCH" });
  await expect(start).toBeDisabled();
  await page.getByRole("button", { name: "READY" }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByLabel("Loading match")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 5_000 });
});
