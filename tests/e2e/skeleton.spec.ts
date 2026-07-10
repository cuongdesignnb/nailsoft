import { test,expect } from '@playwright/test'; test('admin skeleton loads',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Nailsoft operations'})).toBeVisible();});
