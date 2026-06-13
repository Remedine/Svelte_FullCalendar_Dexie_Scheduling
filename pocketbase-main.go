package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	internalSecret := os.Getenv("INTERNAL_SECRET")
	pbPublicURL := os.Getenv("PB_PUBLIC_URL")
	if pbPublicURL == "" {
		pbPublicURL = "https://pocketbase-production-e9a4.up.railway.app"
	}

	// Skip built-in mailer for the flows we handle via Brevo (prevents SMTP timeouts)
	app.OnRecordRequestVerificationRequest().BindFunc(func(e *core.RecordRequestVerificationRequestEvent) error {
		return nil
	})
	app.OnRecordRequestPasswordResetRequest().BindFunc(func(e *core.RecordRequestPasswordResetRequestEvent) error {
		return nil
	})
	app.OnRecordRequestEmailChangeRequest().BindFunc(func(e *core.RecordRequestEmailChangeRequestEvent) error {
		return nil
	})
	app.OnMailerRecordAuthAlertSend().BindFunc(func(e *core.MailerRecordEvent) error {
		return nil
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Ensure the "users" auth collection exists (the one your app + internal routes need)
		if _, err := se.App.FindCollectionByNameOrId("users"); err != nil {
			col := core.NewAuthCollection("users", "users")

			// Fields from your pb_migrations (role, active, force* updates, pinHash, photo, etc.)
			col.Fields.Add(&core.SelectField{
				Name:     "role",
				Values:   []string{"admin", "crew"},
				Required: true,
			})
			col.Fields.Add(&core.BoolField{Name: "active", Required: true})
			col.Fields.Add(&core.BoolField{Name: "forcePinUpdate", Required: true})
			col.Fields.Add(&core.BoolField{Name: "forcePhotoUpdate", Required: true})
			col.Fields.Add(&core.TextField{Name: "pinHash"})
			col.Fields.Add(&core.FileField{
				Name:      "photo",
				MaxSelect: 1,
				MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
			})

			if err := se.App.Save(col); err != nil {
				log.Printf("failed to create 'users' collection: %v", err)
			} else {
				log.Println("created 'users' collection on first start")
			}
		}

		// === options collection fix (no "key" field) ===
		// create without key + remove any legacy "key" from existing collection + seed global record
		// (prevents 400 "Failed to create record" from Svelte client)

		if _, err := se.App.FindCollectionByNameOrId("options"); err != nil {
			col := core.NewBaseCollection("options")
			col.Fields.Add(&core.NumberField{Name: "defaultJobDurationHours"})
			col.Fields.Add(&core.NumberField{Name: "taxRate"})
			col.Fields.Add(&core.NumberField{Name: "invoiceDueDays"})
			col.Fields.Add(&core.JSONField{Name: "areasOfTown"})
			col.Fields.Add(&core.JSONField{Name: "defaultBillableItems"})
			col.Fields.Add(&core.JSONField{Name: "cancelReasons"})
			col.Fields.Add(&core.TextField{Name: "updatedBy"})
			if err := se.App.Save(col); err != nil {
				log.Printf("failed to create 'options' collection: %v", err)
			}
		}

		// remove legacy "key" field if present on existing options collection
		if col, err := se.App.FindCollectionByNameOrId("options"); err == nil {
			for i := len(col.Fields) - 1; i >= 0; i-- {
				if col.Fields[i].GetName() == "key" {
					col.Fields = append(col.Fields[:i], col.Fields[i+1:]...)
					if err := se.App.Save(col); err != nil {
						log.Printf("warning: failed to remove legacy 'key' from options: %v", err)
					} else {
						log.Println("removed legacy 'key' from options collection")
					}
					break
				}
			}
		}

		// seed initial global options record if none exists (runs with full privileges)
		if _, err := se.App.FindFirstRecordByFilter("options", ""); err != nil {
			if col, err := se.App.FindCollectionByNameOrId("options"); err == nil {
				rec := core.NewRecord(col)
				rec.Set("defaultJobDurationHours", 2)
				rec.Set("taxRate", 6.5)
				rec.Set("invoiceDueDays", 30)
				rec.Set("areasOfTown", []any{})
				rec.Set("defaultBillableItems", []any{})
				rec.Set("cancelReasons", []any{})
				rec.Set("updatedBy", "System")
				if err := se.App.SaveRecord(rec); err != nil {
					log.Printf("failed to seed initial options record: %v", err)
				}
			}
		}

		// Initial superuser from Railway env vars (so you can reach /_/)
		if adminEmail := os.Getenv("POCKETBASE_ADMIN_EMAIL"); adminEmail != "" {
			if adminPass := os.Getenv("POCKETBASE_ADMIN_PASSWORD"); adminPass != "" {
				if _, err := se.App.FindAuthRecordByEmail("_superusers", adminEmail); err != nil {
					collection, err := se.App.FindCollectionByNameOrId("_superusers")
					if err == nil && collection != nil {
						newSuper := core.NewRecord(collection)
						newSuper.Set("email", adminEmail)
						newSuper.Set("password", adminPass)
						newSuper.Set("passwordConfirm", adminPass)
						if err := se.App.Save(newSuper); err != nil {
							log.Printf("failed to create initial superuser: %v", err)
						} else {
							log.Printf("initial superuser created for %s", adminEmail)
						}
					}
				}
			}
		}

		checkSecret := func(e *core.RequestEvent) error {
			if e.Request.Header.Get("X-Internal-Secret") != internalSecret {
				return apis.NewForbiddenError("invalid secret", nil)
			}
			return nil
		}

		se.Router.POST("/api/internal/request-verification", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct{ Email string }
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := e.App.FindAuthRecordByEmail("users", body.Email)
			if err != nil {
				return err
			}
			token, err := record.NewVerificationToken()
			if err != nil {
				return err
			}
			link := fmt.Sprintf("%s/_/#/auth/confirm-verification/%s", pbPublicURL, token)
			return e.JSON(http.StatusOK, map[string]string{"link": link})
		})

		se.Router.POST("/api/internal/request-password-reset", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct{ Email string }
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := e.App.FindAuthRecordByEmail("users", body.Email)
			if err != nil {
				return err
			}
			token, err := record.NewPasswordResetToken()
			if err != nil {
				return err
			}
			link := fmt.Sprintf("%s/_/#/auth/confirm-password-reset/%s", pbPublicURL, token)
			return e.JSON(http.StatusOK, map[string]string{"link": link})
		})

		se.Router.POST("/api/internal/request-email-change", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				Email    string
				NewEmail string
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := e.App.FindAuthRecordByEmail("users", body.Email)
			if err != nil {
				return err
			}
			token, err := record.NewEmailChangeToken(body.NewEmail)
			if err != nil {
				return err
			}
			link := fmt.Sprintf("%s/_/#/auth/confirm-email-change/%s", pbPublicURL, token)
			return e.JSON(http.StatusOK, map[string]string{"link": link})
		})

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
