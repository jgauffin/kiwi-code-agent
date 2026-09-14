---
name: relaxjs-forms
description: Building forms with @relax.js/core - FormValidator, readData, setFormData, mapFormToClass and form-associated custom elements. Use when writing an edit or create page, wiring form submit, validating fields, showing an error summary, building a custom input component, or when a form navigates away on submit, a validation message never shows, or a custom control is missing from the submitted data.
---
<!-- @relax.js/core 1.8.0 -->

# Relaxjs forms

The native form API is the state. Do not mirror field values into component state, and do not
build a controlled-input pattern on top.

## FormValidator owns the submit event

Its constructor attaches the listener. Do not add your own, and construct one even when you have
no validation rules, because taking over submit is what it is for. Supplying `submitCallback`
suppresses the native submit, so the page never navigates away.

```typescript
this.form = FormValidator.FindForm(this);
this.validator = new FormValidator(this.form, {
    useSummary: true,
    submitCallback: () => this.save(),
});
```

`submitCallback` is `() => void | Promise<void>` and is awaited. A rejected promise is reported
through `onError` rather than swallowed.

A form that still navigates away on submit means no `FormValidator` was constructed for it.

## Write on load, read on submit

`setFormData(form, dto)` fills the fields from the server, `readData<T>(form)` reads them back
with type conversion, `mapFormToClass(form, instance)` maps onto an existing object. None of them
hooks submit; `FormValidator` is what calls them at the right moment.

## Do not re-render a form the user is editing

Every `render()` writes `value` and `checked` as properties, which replaces text and moves the
caret in a field being typed in. Render the form template once. Handlers stay live. See the
**relaxjs-templates** skill.

## Custom form controls

A custom input participates in a form only if it is form-associated:

```typescript
class RatingInput extends HTMLElement {
    static formAssociated = true;
    private internals = this.attachInternals();
}
```

Expose `name`, `value`, `disabled`, `required`, `dataType`, plus `type` and `checked` for
checkbox-like controls, and implement `getData()`/`setData()` for typed values. Report validity
through `internals.setValidity()`.

The form utilities duck-type every element, never `instanceof`, so a control that exposes the
right properties is handled exactly like a native input. A control missing from `readData()`
output is normally missing `name`, `formAssociated` or a `value` property.

## Detail

- `node_modules/@relax.js/core/docs/forms/form-page.md` for the end-to-end shape of an edit page. Start here
- `node_modules/@relax.js/core/docs/forms/validation.md` for rules, the error summary and every option
- `node_modules/@relax.js/core/docs/forms/reading-writing.md` for type conversion and nested names
- `node_modules/@relax.js/core/docs/forms/form-api.md` for how the utilities detect properties
- `node_modules/@relax.js/core/docs/forms/creating-form-components.md` for building a control
- `node_modules/@relax.js/core/docs/forms/patterns.md` for multi-step forms, unsaved-change guards, uploads
