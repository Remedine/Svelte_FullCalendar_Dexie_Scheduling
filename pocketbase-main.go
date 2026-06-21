package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	// Railway (and similar proxies) often assign different e.RealIP() to the long-lived
	// SSE GET and the follow-up subscribe POST, causing "Invalid realtime client" 400s.
	// PocketBase skips the IP check when pbRealtimeClientIP is unset (apis/realtime.go note2).
	app.OnRealtimeConnectRequest().BindFunc(func(e *core.RealtimeConnectRequestEvent) error {
		e.Client.Unset(apis.RealtimeClientIPKey)
		return e.Next()
	})

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

	// Automatically verify the user record when they successfully complete a password reset.
	// This is used for new users created by admins: the "set your password" step also activates
	// their account (sets verified=true), so we only need a single link/button in the welcome email.
	app.OnRecordConfirmPasswordResetRequest("users").BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		if !e.Record.Verified() {
			e.Record.Set("verified", true)
			if err := e.App.Save(e.Record); err != nil {
				return err
			}
		}
		return e.Next()
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

		// passkeys collection for WebAuthn / passkey login
		if _, err := se.App.FindCollectionByNameOrId("passkeys"); err != nil {
			col := core.NewBaseCollection("passkeys")
			col.Fields.Add(&core.TextField{Name: "userId", Required: true})
			col.Fields.Add(&core.TextField{Name: "credentialId", Required: true})
			col.Fields.Add(&core.TextField{Name: "publicKey", Required: true})
			col.Fields.Add(&core.NumberField{Name: "counter", Required: true})
			col.Fields.Add(&core.JSONField{Name: "transports"})
			col.Fields.Add(&core.TextField{Name: "deviceName"})
			if err := se.App.Save(col); err != nil {
				log.Printf("failed to create 'passkeys' collection: %v", err)
			} else {
				log.Println("created 'passkeys' collection on first start")
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
			col.Fields.Add(&core.DateField{Name: "lastUpdated"})
			col.Fields.Add(&core.TextField{Name: "updatedBy"})
			col.Fields.Add(&core.NumberField{Name: "calendarDayStartHour"})
			col.Fields.Add(&core.NumberField{Name: "calendarDayEndHour"})
			col.Fields.Add(&core.NumberField{Name: "crewAssignmentDaysBefore"})
			col.Fields.Add(&core.NumberField{Name: "crewAssignmentHour"})
			col.Fields.Add(&core.TextField{Name: "businessName"})
			col.Fields.Add(&core.TextField{Name: "businessStreet"})
			col.Fields.Add(&core.TextField{Name: "businessCity"})
			col.Fields.Add(&core.TextField{Name: "businessState"})
			col.Fields.Add(&core.TextField{Name: "businessZip"})
			col.Fields.Add(&core.TextField{Name: "businessPhone"})
			col.Fields.Add(&core.TextField{Name: "businessEmail"})
			col.Fields.Add(&core.TextField{Name: "businessWebsite"})
			col.Fields.Add(&core.TextField{Name: "businessMailingStreet"})
			col.Fields.Add(&core.TextField{Name: "businessMailingCity"})
			col.Fields.Add(&core.TextField{Name: "businessMailingState"})
			col.Fields.Add(&core.TextField{Name: "businessMailingZip"})
			col.Fields.Add(&core.TextField{Name: "businessSalesTaxAccount"})
			col.Fields.Add(&core.TextField{Name: "salesTaxJurisdiction"})
			col.Fields.Add(&core.TextField{Name: "invoiceNumberPrefix"})
			col.Fields.Add(&core.NumberField{Name: "nextInvoiceNumber"})
			col.Fields.Add(&core.NumberField{Name: "invoiceNumberYear"})
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
				rec.Set("taxRate", 5)
				rec.Set("invoiceDueDays", 30)
				rec.Set("areasOfTown", []any{})
				rec.Set("defaultBillableItems", []any{})
				rec.Set("cancelReasons", []any{})
				rec.Set("calendarDayStartHour", 6)
				rec.Set("calendarDayEndHour", 22)
				rec.Set("crewAssignmentDaysBefore", 1)
				rec.Set("crewAssignmentHour", 7)
				rec.Set("businessName", "Capital City Windows")
				rec.Set("businessCity", "Juneau")
				rec.Set("businessState", "AK")
				rec.Set("salesTaxJurisdiction", "City and Borough of Juneau sales tax")
				rec.Set("invoiceNumberPrefix", "CCW")
				rec.Set("nextInvoiceNumber", 1)
				rec.Set("invoiceNumberYear", time.Now().Year())
				rec.Set("updatedBy", "System")
				if err := se.App.Save(rec); err != nil {
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

		normalizeCredentialId := func(id string) string {
			return strings.ReplaceAll(id, "=", "")
		}

		findPasskeyByCredentialId := func(app core.App, credentialId string) (*core.Record, error) {
			normalized := normalizeCredentialId(credentialId)
			record, err := app.FindFirstRecordByFilter(
				"passkeys",
				fmt.Sprintf("credentialId = '%s'", normalized),
			)
			if err == nil {
				return record, nil
			}
			if normalized != credentialId {
				return app.FindFirstRecordByFilter(
					"passkeys",
					fmt.Sprintf("credentialId = '%s'", credentialId),
				)
			}
			return nil, err
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

		se.Router.POST("/api/internal/user-by-email", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				Email string `json:"email"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := e.App.FindAuthRecordByEmail("users", strings.TrimSpace(body.Email))
			if err != nil {
				return apis.NewNotFoundError("user not found", err)
			}
			return e.JSON(http.StatusOK, map[string]any{
				"id":        record.Id,
				"email":     record.Email(),
				"firstName": record.GetString("firstName"),
				"lastName":  record.GetString("lastName"),
				"name":      record.GetString("name"),
			})
		})

		// Full user roster for admin Dexie sync (includes emails hidden from client list rules).
		se.Router.GET("/api/internal/users-roster", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			records, err := e.App.FindAllRecords("users")
			if err != nil {
				return err
			}
			recordTime := func(rec *core.Record, names ...string) string {
				for _, name := range names {
					dt := rec.GetDateTime(name)
					if !dt.IsZero() {
						return dt.Time().UTC().Format(time.RFC3339)
					}
				}
				return ""
			}
			items := make([]map[string]any, 0, len(records))
			for _, rec := range records {
				created := recordTime(rec, "createdAt", "created")
				updated := recordTime(rec, "updatedAt", "updated")
				items = append(items, map[string]any{
					"id":               rec.Id,
					"email":            rec.Email(),
					"firstName":        rec.GetString("firstName"),
					"lastName":         rec.GetString("lastName"),
					"name":             rec.GetString("name"),
					"role":             rec.GetString("role"),
					"photo":            rec.GetString("photo"),
					"active":           rec.GetBool("active"),
					"forcePinUpdate":   rec.GetBool("forcePinUpdate"),
					"forcePhotoUpdate": rec.GetBool("forcePhotoUpdate"),
					"verified":         rec.Verified(),
					"createdAt":        created,
					"updatedAt":        updated,
					"created":          created,
					"updated":          updated,
				})
			}
			return e.JSON(http.StatusOK, map[string]any{
				"items":      items,
				"totalItems": len(items),
			})
		})

		se.Router.POST("/api/internal/passkeys/by-credential", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				CredentialId string `json:"credentialId"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := findPasskeyByCredentialId(e.App, body.CredentialId)
			if err != nil {
				return apis.NewNotFoundError("passkey not found", err)
			}
			return e.JSON(http.StatusOK, map[string]any{
				"id":           record.Id,
				"userId":       record.GetString("userId"),
				"credentialId": record.GetString("credentialId"),
				"publicKey":    record.GetString("publicKey"),
				"counter":      record.GetFloat("counter"),
				"transports":   record.Get("transports"),
				"deviceName":   record.GetString("deviceName"),
			})
		})

		se.Router.POST("/api/internal/passkeys/list", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				UserId string `json:"userId"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			records, err := e.App.FindRecordsByFilter(
				"passkeys",
				fmt.Sprintf("userId = '%s'", body.UserId),
				"-created",
				50,
				0,
			)
			if err != nil {
				return err
			}
			items := make([]map[string]any, 0, len(records))
			for _, rec := range records {
				items = append(items, map[string]any{
					"id":           rec.Id,
					"userId":       rec.GetString("userId"),
					"credentialId": rec.GetString("credentialId"),
					"publicKey":    rec.GetString("publicKey"),
					"counter":      rec.GetFloat("counter"),
					"transports":   rec.Get("transports"),
					"deviceName":   rec.GetString("deviceName"),
					"created":      rec.GetDateTime("created").Time().UTC().Format(time.RFC3339),
				})
			}
			return e.JSON(http.StatusOK, map[string]any{"items": items})
		})

		se.Router.POST("/api/internal/passkeys/save", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				UserId       string   `json:"userId"`
				CredentialId string   `json:"credentialId"`
				PublicKey    string   `json:"publicKey"`
				Counter      float64  `json:"counter"`
				Transports   []string `json:"transports"`
				DeviceName   string   `json:"deviceName"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			col, err := e.App.FindCollectionByNameOrId("passkeys")
			if err != nil {
				return err
			}
			normalizedCredentialId := normalizeCredentialId(body.CredentialId)
			existing, findErr := findPasskeyByCredentialId(e.App, body.CredentialId)
			var rec *core.Record
			if findErr != nil {
				rec = core.NewRecord(col)
			} else {
				rec = existing
			}
			rec.Set("userId", body.UserId)
			rec.Set("credentialId", normalizedCredentialId)
			rec.Set("publicKey", body.PublicKey)
			rec.Set("counter", body.Counter)
			rec.Set("transports", body.Transports)
			rec.Set("deviceName", body.DeviceName)
			if err := e.App.Save(rec); err != nil {
				return err
			}
			return e.JSON(http.StatusOK, map[string]string{"id": rec.Id})
		})

		se.Router.POST("/api/internal/passkeys/update-counter", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				CredentialId string  `json:"credentialId"`
				Counter      float64 `json:"counter"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := findPasskeyByCredentialId(e.App, body.CredentialId)
			if err != nil {
				return apis.NewNotFoundError("passkey not found", err)
			}
			record.Set("counter", body.Counter)
			if err := e.App.Save(record); err != nil {
				return err
			}
			return e.JSON(http.StatusOK, map[string]bool{"success": true})
		})

		se.Router.POST("/api/internal/passkeys/delete", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				CredentialId string `json:"credentialId"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := findPasskeyByCredentialId(e.App, body.CredentialId)
			if err != nil {
				return apis.NewNotFoundError("passkey not found", err)
			}
			if err := e.App.Delete(record); err != nil {
				return err
			}
			return e.JSON(http.StatusOK, map[string]bool{"success": true})
		})

		se.Router.POST("/api/internal/auth-token", func(e *core.RequestEvent) error {
			if err := checkSecret(e); err != nil {
				return err
			}
			var body struct {
				UserId string `json:"userId"`
			}
			if err := e.BindBody(&body); err != nil {
				return err
			}
			record, err := e.App.FindRecordById("users", body.UserId)
			if err != nil {
				return apis.NewNotFoundError("user not found", err)
			}
			if !record.Collection().IsAuth() {
				return apis.NewNotFoundError("user not found", nil)
			}
			if !record.GetBool("active") {
				return apis.NewForbiddenError("account deactivated", nil)
			}
			token, err := record.NewAuthToken()
			if err != nil {
				return err
			}
			return e.JSON(http.StatusOK, map[string]any{
				"token":  token,
				"record": record.PublicExport(),
			})
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
