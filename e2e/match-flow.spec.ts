import { expect, test } from "@playwright/test";

test("a player can enter a match, ride, swing, and reach the final summary", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.getByRole("button", { name: "ENTER KING'S CUP" }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyW");
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();

  await expect(page.locator(".broadcast")).toContainText("CHUKKER");
  await expect(page.locator(".telemetry")).toHaveAttribute("data-speed-kmh", /\d+\.\d/);
  await expect(page.locator(".radar .rider")).toHaveCount(8);

  await page.evaluate(() => window.dispatchEvent(new Event("polo-e2e-complete")));
  await expect(page.getByRole("dialog", { name: "Post match summary" })).toBeVisible();
});
