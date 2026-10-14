import { expect, test } from "@playwright/test";

test.describe("weaving a name", () => {
  test("weaves the name from a shared link and finishes the cloth", async ({ page }) => {
    await page.goto("/?name=Ada%20Lovelace");
    await expect(page.getByLabel("Your name", { exact: true })).toHaveValue("Ada Lovelace");
    await expect(page.locator("#binary")).toContainText("Ada Lovelace → 01000001 01100100");
    await expect(page.locator("#card-count")).toHaveText("64 / 64");
    await expect(page.getByRole("button", { name: "Download your cloth" })).toBeEnabled();
    await expect(page.locator("#side")).toContainText("Off the loom");
  });

  test("weaves a new name and puts it in the link", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill("Anu");
    await page.getByRole("button", { name: "Weave" }).click();
    await expect(page).toHaveURL(/name=Anu/);
    await expect(page.locator("#binary")).toHaveText("Anu → 01000001 01101110 01110101");
  });

  test("an empty name falls back to the default", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Weave" }).click();
    await expect(page.locator("#binary")).toContainText("JACQUARD →");
  });
});

test.describe("the finished cloth", () => {
  test("turns over to show the reversed back, and back again", async ({ page }) => {
    await page.goto("/?name=Ada");
    const turn = page.getByRole("button", { name: "Turn the cloth" });
    await expect(turn).toBeEnabled();
    await turn.click();
    await expect(page.locator("#side")).toContainText("The back", { timeout: 10_000 });
    await turn.click();
    await expect(page.locator("#side")).toContainText("The front", { timeout: 10_000 });
  });

  test("downloads the cloth as a PNG named after the weaver", async ({ page }) => {
    await page.goto("/?name=Ada%20Lovelace");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download your cloth" }).click();
    expect((await download).suggestedFilename()).toBe("jacquard-ada-lovelace.png");
  });

  test("lets you pick the thread colours", async ({ page }) => {
    await page.goto("/?name=Ada");
    const madder = page.getByRole("radio", { name: "Madder" });
    await madder.click();
    await expect(madder).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Indigo" })).toHaveAttribute("aria-checked", "false");
  });
});

test("the timeline marks each era as you reach it", async ({ page }) => {
  await page.goto("/?name=Ada");
  const eras = page.locator(".era");
  await expect(eras).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    // the 3D layers keep the page moving, so scroll directly rather than waiting for it to settle
    await eras.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(eras.nth(i)).toHaveClass(/in/);
  }
  await expect(page.locator(".era h3").last()).toHaveText("Your cloth");
});
