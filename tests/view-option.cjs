// Exercise the custom toolbar, never a hidden/native select stand-in.
module.exports = async function viewOption(page, group, option) {
  if (!await page.locator('details.view-options').evaluate(element => element.open)) {
    await page.getByRole('button', {name: 'View options', exact: true}).click();
  }
  await page.getByRole('group', {name: group, exact: true}).getByRole('button', {name: option, exact: true}).click();
  await page.keyboard.press('Escape');
};
