import { expect, test } from "@playwright/test";
import { EconomyManager } from "../src/services/Economy";
import { initializeMatchEntities } from "../src/game/GameState";

test("transactional shop purchase deducts Gold and unlocks the item", () => { EconomyManager.reset(); const before=EconomyManager.get(),result=EconomyManager.purchase("crown"); expect(result.ok).toBe(true); expect(result.profile.gold).toBe(before.gold-900); expect(result.profile.unlocked).toContain("crown"); EconomyManager.reset(); });
test("equipped horse coat persists into the active player entity", () => { EconomyManager.reset(); EconomyManager.equip({coat:"Gray"}); expect(EconomyManager.get().loadout.coat).toBe("Gray"); expect(initializeMatchEntities().player.coat).toBe("Gray"); EconomyManager.reset(); });
test("shop and stable tabs update visible economy and loadout state", async ({page}) => { await page.goto("/"); await page.getByRole("button",{name:"SHOP",exact:true}).click(); await expect(page.getByLabel("Gold balance")).toContainText("5000"); await page.getByRole("button",{name:"900 GOLD"}).click(); await expect(page.getByLabel("Gold balance")).toContainText("4100"); await page.getByRole("button",{name:"HORSES",exact:true}).click(); const gray=page.getByRole("button",{name:/Gray/}); await gray.click(); await expect(gray).toContainText("EQUIPPED"); });
