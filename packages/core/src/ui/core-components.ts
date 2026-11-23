// Core's UI Components (ADR-0019), the ones a Mod Blueprint's `ui` turns on by id.

import { BOSS_BAR } from "./boss-bar.js";
import { CHOICE_PICKER } from "./choice-picker.js";
import { HERO_MOMENT } from "./hero-moment.js";
import { TOAST } from "./toast.js";
import type { UiComponent } from "./ui-component.js";

/** Core's UI Components. */
export const UI_COMPONENTS: readonly UiComponent[] = [BOSS_BAR, TOAST, CHOICE_PICKER, HERO_MOMENT];
