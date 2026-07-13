import { expect, test } from "@playwright/test";

test("the local app exposes health and a usable first screen", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText("Spent", { exact: true }).first()).toBeVisible();
});
