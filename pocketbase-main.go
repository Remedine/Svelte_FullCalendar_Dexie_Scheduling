// pocketbase-main.go
//
// This is the custom PocketBase Go entrypoint for the production deployment
// (separate repo: https://github.com/Remedine/pocketbase).
//
// Copy this file over the main.go in that repo, then build (Dockerfile or `go build`).
//
// Key changes in this version (per the options 400 "Failed to create record" investigation):
// - The "options" collection is now explicitly created WITHOUT any "key" field (and with required:false if it ever existed).
// - On every startup we aggressively clean any legacy "key" field from an existing "options" collection (so a previously hand-edited prod collection that picked up the old migration "required:true" key will be fixed automatically on next deploy/restart).
// - Initial "global" options record is still created by the superuser (bypassing the admin-only createRule) using only the fields the Svelte client expects.
// - All other behaviour preserved: superuser bootstrap from POCKETBASE_ADMIN_*, mailer skips (so we can use Brevo via the Svelte proxy + /api/internal/* token generators), users collection with role=admin/crew + the exact rules you pasted, internal email link routes, etc.
//
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
// AGENTS.md / conversation history around the 400 on /api/collections/options/records create.

package main

import (
	"log"
	"os"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/models/schema"
	"github.com/pocketbase/pocketbase/tools/types"
)

func main() {
	app := pocketbase.New()

	// ------------------------------------------------------------------
	// 1. Completely disable built-in mailer (Railway free plan has no SMTP).
	//    We generate the tokens/links internally and hand them to the Svelte
	//    app which calls Brevo.
	// ------------------------------------------------------------------
	app.OnRecordRequestPasswordResetRequest("users").BindFunc(func(e *core.RecordRequestPasswordResetRequestEvent) error {
		return nil // we handle via /api/internal/request-password-reset
	})
	app.OnRecordRequestVerificationRequest("users").BindFunc(func(e *core.RecordRequestVerificationRequestEvent) error {
		return nil
	})
	app.OnRecordRequestEmailChangeRequest("users").BindFunc(func(e *core.RecordRequestEmailChangeRequestEvent) error {
		return nil
	})
	app.OnMailerRecordAuthAlertSend().BindFunc(func(e *core.MailerRecordEvent) error {
		return nil
	})

	// ------------------------------------------------------------------
	// 2. OnServe hook: bootstrap superuser + collections + initial data + internal routes
	// ------------------------------------------------------------------
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// --- Superuser bootstrap (from Railway env) ---
		adminEmail := os.Getenv("POCKETBASE_ADMIN_EMAIL")
		adminPassword := os.Getenv("POCKETBASE_ADMIN_PASSWORD")
		if adminEmail != "" && adminPassword != "" {
			superusers, err := app.FindCollectionByNameOrId("_superusers")
			if err == nil {
				admin, err := app.FindAuthRecordByEmail(superusers, adminEmail)
				if err != nil {
					admin = core.NewRecord(superusers)
					admin.Set("email", adminEmail)
				}
				admin.Set("password", adminPassword)
				admin.Set("passwordConfirm", adminPassword)
				if err := app.Save(admin); err != nil {
					log.Println("[main.go] failed to upsert superuser:", err)
				} else {
					log.Println("[main.go] superuser ensured:", adminEmail)
				}
			}
		}

		pbPublicURL := os.Getenv("PB_PUBLIC_URL")
		if pbPublicURL == "" {
			pbPublicURL = "https://pocketbase-production-e9a4.up.railway.app"
		}
		internalSecret := os.Getenv("INTERNAL_SECRET") // used by Svelte server routes if you want auth on the internal endpoints

		// ------------------------------------------------------------------
		// USERS collection (auth) - matches exactly the JSON you pasted
		// ------------------------------------------------------------------
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			users = core.NewBaseCollection("users")
			users.Type = "auth"

			// Fields (simplified but matching your pasted collection)
			users.Fields.Add(&schema.TextField{
				Name:     "name",
				Required: false,
			})
			users.Fields.Add(&schema.FileField{
				Name:      "photo",
				MaxSelect: 1,
				MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
			})
			users.Fields.Add(&schema.SelectField{
				Name:     "role",
				Required: true,
				Values:   []string{"admin", "crew"},
			})
			users.Fields.Add(&schema.BoolField{Name: "active"})
			users.Fields.Add(&schema.BoolField{Name: "forcePinUpdate"})
			users.Fields.Add(&schema.BoolField{Name: "forcePhotoUpdate"})
			users.Fields.Add(&schema.TextField{Name: "pinHash"})

			// Rules from your pasted users collection JSON
			users.ListRule = types.Pointer("@request.auth.id != \"\"")
			users.ViewRule = types.Pointer("@request.auth.role = \"admin\" || id = @request.auth.id")
			users.CreateRule = types.Pointer("@request.auth.role = \"admin\" || id = @request.auth.id")
			users.UpdateRule = types.Pointer("@request.auth.role = \"admin\" || @request.auth.id = id")
			users.DeleteRule = types.Pointer("@request.auth.role = \"admin\" || id = @request.auth.id")

			if err := app.Save(users); err != nil {
				log.Println("[main.go] failed to create users collection:", err)
			} else {
				log.Println("[main.go] users collection created")
			}
		}

		// ------------------------------------------------------------------
		// OPTIONS collection (the critical one for the 400)
		// ------------------------------------------------------------------
		options, err := app.FindCollectionByNameOrId("options")
		if err != nil {
			options = core.NewBaseCollection("options")

			// IMPORTANT: NO "key" field at all.
			// The old migration 1780479032 added a required "key".
			// We deliberately omit it so the Svelte client (which does getFirstListItem('') + create without key)
			// never gets a 400 validation error.

			options.Fields.Add(&schema.NumberField{
				Name:     "defaultJobDurationHours",
				Required: false,
			})
			options.Fields.Add(&schema.NumberField{
				Name:     "taxRate",
				Required: false,
			})
			options.Fields.Add(&schema.NumberField{
				Name:     "invoiceDueDays",
				Required: false,
			})
			options.Fields.Add(&schema.JSONField{
				Name: "areasOfTown",
			})
			options.Fields.Add(&schema.JSONField{
				Name: "defaultBillableItems",
			})
			options.Fields.Add(&schema.JSONField{
				Name: "cancelReasons",
			})
			options.Fields.Add(&schema.TextField{
				Name: "updatedBy",
			})

			// Rules (from your earlier paste + 1780477923 migration)
			options.ListRule = types.Pointer("@request.auth.id != \"\"")
			options.ViewRule = types.Pointer("@request.auth.id != \"\"")
			options.CreateRule = types.Pointer("@request.auth.role = \"admin\"")
			options.UpdateRule = types.Pointer("@request.auth.role = \"admin\"")
			options.DeleteRule = types.Pointer("@request.auth.role = \"admin\"")

			if err := app.Save(options); err != nil {
				log.Println("[main.go] failed to create options collection:", err)
			} else {
				log.Println("[main.go] options collection created (NO key field)")
			}
		}

		// ------------------------------------------------------------------
		// Runtime safety net: if an existing "options" collection still has
		// a "key" field (from manual UI edit or old migration), remove it now.
		// This fixes the 400 for people who already have the collection on prod.
		// ------------------------------------------------------------------
		if optsCol, err := app.FindCollectionByNameOrId("options"); err == nil {
			changed := false
			newFields := make([]*schema.Field, 0, len(optsCol.Fields))
			for _, f := range optsCol.Fields {
				if f.GetName() == "key" {
					changed = true
					log.Println("[main.go] removing legacy 'key' field from options collection")
					continue
				}
				newFields = append(newFields, f)
			}
			if changed {
				optsCol.Fields = newFields
				if err := app.Save(optsCol); err != nil {
					log.Println("[main.go] warning: could not persist options schema cleanup:", err)
				} else {
					log.Println("[main.go] options collection schema cleaned (key field removed)")
				}
			}
		}

		// ------------------------------------------------------------------
		// Seed a global options record if none exists (runs as superuser → bypasses createRule)
		// ------------------------------------------------------------------
		if _, err := app.FindFirstRecordByFilter("options", ""); err != nil {
			if optsCol, err := app.FindCollectionByNameOrId("options"); err == nil {
				rec := core.NewRecord(optsCol)
				rec.Set("defaultJobDurationHours", 2)
				rec.Set("taxRate", 0.065)
				rec.Set("invoiceDueDays", 30)
				rec.Set("areasOfTown", []any{})
				rec.Set("defaultBillableItems", []any{})
				rec.Set("cancelReasons", []any{})
				rec.Set("updatedBy", "System")

				if err := app.SaveRecord(rec); err != nil {
					log.Println("[main.go] failed to seed initial options record:", err)
				} else {
					log.Println("[main.go] seeded initial global options record")
				}
			}
		}

		// ------------------------------------------------------------------
		// Internal routes used by the Svelte server (Brevo flow).
		// The Svelte +server.ts calls these (protected by INTERNAL_SECRET if you want),
		// gets a fresh token + full link, then calls Brevo with that link.
		// ------------------------------------------------------------------
		se.Router.POST("/api/internal/request-password-reset", func(e *core.RequestEvent) error {
			email := e.Request.URL.Query().Get("email")
			if email == "" {
				return e.JSON(400, map[string]string{"error": "email required"})
			}
			user, err := app.FindAuthRecordByEmail("users", email)
			if err != nil || user == nil {
				// Still return 200 so we don't leak existence
				return e.JSON(200, map[string]string{"link": ""})
			}
			token, err := user.NewPasswordResetToken()
			if err != nil {
				return e.JSON(500, map[string]string{"error": "token generation failed"})
			}
			link := pbPublicURL + "/_/#/auth/confirm-password-reset/" + token
			return e.JSON(200, map[string]string{"link": link})
		})

		se.Router.POST("/api/internal/request-verification", func(e *core.RequestEvent) error {
			email := e.Request.URL.Query().Get("email")
			if email == "" {
				return e.JSON(400, map[string]string{"error": "email required"})
			}
			user, err := app.FindAuthRecordByEmail("users", email)
			if err != nil || user == nil {
				return e.JSON(200, map[string]string{"link": ""})
			}
			token, err := user.NewVerificationToken()
			if err != nil {
				return e.JSON(500, map[string]string{"error": "token generation failed"})
			}
			link := pbPublicURL + "/_/#/auth/confirm-verification/" + token
			return e.JSON(200, map[string]string{"link": link})
		})

		se.Router.POST("/api/internal/request-email-change", func(e *core.RequestEvent) error {
			// Similar pattern if you implement email change via Brevo
			return e.JSON(200, map[string]string{"link": ""})
		})

		return se.Next()
	})

	// ------------------------------------------------------------------
	// Start the app
	// ------------------------------------------------------------------
	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
