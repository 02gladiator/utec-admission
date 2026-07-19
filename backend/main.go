package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type server struct {
	db                        *pgxpool.Pool
	redis                     *redis.Client
	adminLogin, adminPassword string
	startedAt                 time.Time
	metricsMu                 sync.Mutex
	requests                  map[string]uint64
	durations                 map[string]float64
}
type program struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	BudgetSeats int    `json:"budgetSeats"`
	PaidSeats   int    `json:"paidSeats"`
}
type applicationRow struct {
	Name           string  `json:"name"`
	AverageScore   float64 `json:"averageScore"`
	OriginalGiven  bool    `json:"originalGiven"`
	Benefit        bool    `json:"benefit,omitempty"`
	OverallRank    int     `json:"overallRank"`
	OriginalRank   *int    `json:"originalRank,omitempty"`
	BudgetOverall  bool    `json:"budgetOverall"`
	BudgetOriginal bool    `json:"budgetOriginal"`
	Matched        bool    `json:"matched"`
}
type createApplicationRequest struct {
	SNILS         string  `json:"snils"`
	FullName      string  `json:"fullName"`
	ProgramCode   string  `json:"programCode"`
	AverageScore  float64 `json:"averageScore"`
	OriginalGiven bool    `json:"originalGiven"`
	Benefit       bool    `json:"benefit"`
}
type importApplicationsRequest struct {
	ProgramCode  string                     `json:"programCode"`
	Applications []importApplicationRequest `json:"applications"`
}
type importApplicationRequest struct {
	Row           int     `json:"row"`
	SNILS         string  `json:"snils"`
	FullName      string  `json:"fullName"`
	AverageScore  float64 `json:"averageScore"`
	OriginalGiven bool    `json:"originalGiven"`
	Benefit       bool    `json:"benefit"`
}

var initialPrograms = []program{
	{"21.02.19", "Землеустройство", 25, 30}, {"38.02.01", "Экономика и бухгалтерский учёт (по отраслям)", 25, 0}, {"38.02.02", "Страховое дело", 25, 0}, {"38.02.03", "Операционная деятельность в логистике", 50, 30}, {"38.02.06", "Финансы", 0, 25}, {"38.02.07", "Банковское дело", 25, 30}, {"38.02.08", "Торговое дело", 75, 0}, {"43.02.16", "Туризм и гостеприимство", 50, 50}, {"43.02.15", "Поварское и кондитерское дело", 25, 0}, {"42.02.04", "Юриспруденция", 0, 50},
}

func main() {
	ctx := context.Background()
	dbURL := env("DATABASE_URL", "postgres://utec:utec_dev_password@localhost:5433/utec_admissions?sslmode=disable")
	db, err := openDatabase(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := seedPrograms(ctx, db); err != nil {
		log.Fatal(err)
	}
	redisOptions, err := redis.ParseURL(env("REDIS_URL", "redis://localhost:6379/0"))
	if err != nil {
		log.Fatal(err)
	}
	rdb := redis.NewClient(redisOptions)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal(err)
	}
	defer rdb.Close()
	s := &server{db: db, redis: rdb, adminLogin: env("ADMIN_LOGIN", "postgres"), adminPassword: env("ADMIN_PASSWORD", "123456"), startedAt: time.Now(), requests: map[string]uint64{}, durations: map[string]float64{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("GET /api/public/programs", s.publicPrograms)
	mux.HandleFunc("GET /api/public/applications", s.publicApplications)
	mux.HandleFunc("POST /api/admin/login", s.login)
	mux.HandleFunc("POST /api/admin/logout", s.logout)
	mux.HandleFunc("GET /api/admin/session", s.session)
	mux.HandleFunc("GET /api/admin/programs", s.adminPrograms)
	mux.HandleFunc("GET /api/admin/applications", s.adminApplications)
	mux.HandleFunc("POST /api/admin/applications", s.createApplication)
	mux.HandleFunc("DELETE /api/admin/applications", s.deleteProgramApplications)
	mux.HandleFunc("POST /api/admin/applications/import", s.importApplications)
	mux.HandleFunc("PUT /api/admin/applications/{id}", s.updateApplication)
	mux.HandleFunc("DELETE /api/admin/applications/{id}", s.deleteApplication)
	mux.HandleFunc("POST /api/admin/publish", s.publish)
	log.Println("API available at http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", s.withMetrics(mux)))
}

type metricsWriter struct {
	http.ResponseWriter
	status int
}

func (w *metricsWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (s *server) withMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		writer := &metricsWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(writer, r)
		key := r.Method + " " + r.URL.Path + " " + fmt.Sprint(writer.status)
		s.metricsMu.Lock()
		s.requests[key]++
		s.durations[key] += time.Since(start).Seconds()
		s.metricsMu.Unlock()
	})
}
func (s *server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	fmt.Fprintf(w, "# HELP utec_http_requests_total HTTP requests\n# TYPE utec_http_requests_total counter\n# HELP utec_http_request_duration_seconds HTTP duration\n# TYPE utec_http_request_duration_seconds summary\n")
	for key, count := range s.requests {
		fmt.Fprintf(w, "utec_http_requests_total{request=%q} %d\nutec_http_request_duration_seconds_sum{request=%q} %.6f\nutec_http_request_duration_seconds_count{request=%q} %d\n", key, count, key, s.durations[key], key, count)
	}
	fmt.Fprintf(w, "utec_process_uptime_seconds %.0f\n", time.Since(s.startedAt).Seconds())
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
func seedPrograms(ctx context.Context, db *pgxpool.Pool) error {
	for _, p := range initialPrograms {
		_, err := db.Exec(ctx, `INSERT INTO programs(code,name,budget_seats,paid_seats) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING`, p.Code, p.Name, p.BudgetSeats, p.PaidSeats)
		if err != nil {
			return err
		}
	}
	return nil
}
func respond(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
func normalize(v string) string {
	v = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(v)), "ё", "е")
	return strings.Join(strings.Fields(v), " ")
}
func maskName(v string) string {
	parts := strings.Fields(v)
	for i := range parts {
		if i == 0 {
			parts[i] = "••••••"
		} else {
			parts[i] = string([]rune(parts[i])[0]) + "."
		}
	}
	return strings.Join(parts, " ")
}

func (s *server) programs(ctx context.Context) ([]program, error) {
	rows, err := s.db.Query(ctx, `SELECT code,name,budget_seats,paid_seats FROM programs ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []program{}
	for rows.Next() {
		var p program
		if err := rows.Scan(&p.Code, &p.Name, &p.BudgetSeats, &p.PaidSeats); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
func (s *server) publicPrograms(w http.ResponseWriter, r *http.Request) {
	p, err := s.programs(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	respond(w, 200, p)
}
func (s *server) publicApplications(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("program")
	originalOnly := r.URL.Query().Get("original") == "true"
	search := normalize(r.URL.Query().Get("fio"))
	programs, err := s.programs(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	var selected *program
	for i := range programs {
		if programs[i].Code == code {
			selected = &programs[i]
			break
		}
	}
	if selected == nil {
		respond(w, 400, map[string]string{"error": "unknown program"})
		return
	}
	cacheKey := fmt.Sprintf("public-list:%s:%t", code, originalOnly)
	if search == "" {
		if cached, err := s.redis.Get(r.Context(), cacheKey).Bytes(); err == nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write(cached)
			return
		}
	}
	rows, err := s.db.Query(r.Context(), `SELECT a.full_name,x.average_score::float8,x.original_given FROM applications x JOIN applicants a ON a.id=x.applicant_id JOIN programs p ON p.id=x.program_id WHERE p.code=$1 AND ($2=false OR x.original_given=true) ORDER BY x.average_score DESC`, code, originalOnly)
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()
	result := []applicationRow{}
	originalRank := 0
	for rows.Next() {
		var item applicationRow
		if err := rows.Scan(&item.Name, &item.AverageScore, &item.OriginalGiven); err != nil {
			respond(w, 500, map[string]string{"error": "database error"})
			return
		}
		item.OverallRank = len(result) + 1
		if item.OriginalGiven {
			originalRank++
			x := originalRank
			item.OriginalRank = &x
		}
		item.BudgetOverall = item.OverallRank <= selected.BudgetSeats
		item.BudgetOriginal = item.OriginalGiven && originalRank <= selected.BudgetSeats
		item.Matched = search != "" && normalize(item.Name) == search
		if !item.Matched {
			item.Name = maskName(item.Name)
		}
		result = append(result, item)
	}
	payload := map[string]any{"program": selected, "applications": result}
	if search == "" {
		if raw, err := json.Marshal(payload); err == nil {
			_ = s.redis.Set(r.Context(), cacheKey, raw, time.Minute).Err()
		}
	}
	respond(w, 200, payload)
}

func (s *server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	cookie, err := r.Cookie("utec_admin_session")
	if err != nil {
		return false
	}
	return s.redis.Get(r.Context(), "session:"+cookie.Value).Val() == s.adminLogin
}
func (s *server) invalidatePublicLists(ctx context.Context) {
	var cursor uint64
	for {
		keys, next, err := s.redis.Scan(ctx, cursor, "public-list:*", 100).Result()
		if err != nil || len(keys) > 0 {
			_ = s.redis.Del(ctx, keys...).Err()
		}
		cursor = next
		if cursor == 0 {
			return
		}
	}
}
func (s *server) session(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, map[string]bool{"authenticated": s.requireAdmin(w, r)})
}
func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || subtle.ConstantTimeCompare([]byte(body.Login), []byte(s.adminLogin)) != 1 || subtle.ConstantTimeCompare([]byte(body.Password), []byte(s.adminPassword)) != 1 {
		respond(w, 401, map[string]string{"error": "invalid credentials"})
		return
	}
	raw := make([]byte, 32)
	_, _ = rand.Read(raw)
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.redis.Set(r.Context(), "session:"+token, s.adminLogin, 12*time.Hour).Err(); err != nil {
		respond(w, 500, map[string]string{"error": "session error"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "utec_admin_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 43200})
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("utec_admin_session"); err == nil {
		_ = s.redis.Del(r.Context(), "session:"+c.Value).Err()
	}
	http.SetCookie(w, &http.Cookie{Name: "utec_admin_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *server) adminPrograms(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	s.publicPrograms(w, r)
}
func (s *server) adminApplications(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT x.id,a.snils,a.full_name,p.code,p.name,x.average_score::float8,x.original_given,x.benefit FROM applications x JOIN applicants a ON a.id=x.applicant_id JOIN programs p ON p.id=x.program_id ORDER BY p.code,x.average_score DESC`)
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer rows.Close()
	type item struct {
		ID            int64   `json:"id"`
		SNILS         string  `json:"snils"`
		FullName      string  `json:"fullName"`
		ProgramCode   string  `json:"programCode"`
		ProgramName   string  `json:"programName"`
		AverageScore  float64 `json:"averageScore"`
		OriginalGiven bool    `json:"originalGiven"`
		Benefit       bool    `json:"benefit"`
	}
	result := []item{}
	for rows.Next() {
		var x item
		if err := rows.Scan(&x.ID, &x.SNILS, &x.FullName, &x.ProgramCode, &x.ProgramName, &x.AverageScore, &x.OriginalGiven, &x.Benefit); err != nil {
			respond(w, 500, map[string]string{"error": "database error"})
			return
		}
		result = append(result, x)
	}
	respond(w, 200, result)
}

func (s *server) deleteApplication(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	result, err := s.db.Exec(r.Context(), `DELETE FROM applications WHERE id=$1`, r.PathValue("id"))
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	if result.RowsAffected() == 0 {
		respond(w, 404, map[string]string{"error": "not found"})
		return
	}
	s.invalidatePublicLists(r.Context())
	respond(w, 200, map[string]bool{"ok": true})
}

func (s *server) deleteProgramApplications(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("program"))
	if code == "" {
		respond(w, 400, map[string]string{"error": "program is required"})
		return
	}
	result, err := s.db.Exec(r.Context(), `DELETE FROM applications WHERE program_id=(SELECT id FROM programs WHERE code=$1)`, code)
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	s.invalidatePublicLists(r.Context())
	respond(w, 200, map[string]any{"ok": true, "deleted": result.RowsAffected()})
}

func (s *server) updateApplication(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var in createApplicationRequest
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON"})
		return
	}
	snils, err := formatSNILS(in.SNILS)
	if err != nil || !validFullName(in.FullName) || !validAverageScore(in.AverageScore) {
		respond(w, 400, map[string]string{"error": "check input"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer tx.Rollback(r.Context())
	var applicantID int64
	err = tx.QueryRow(r.Context(), `INSERT INTO applicants(snils,full_name) VALUES($1,$2) ON CONFLICT(snils) DO UPDATE SET full_name=EXCLUDED.full_name,updated_at=now() RETURNING id`, snils, strings.TrimSpace(in.FullName)).Scan(&applicantID)
	var result pgconn.CommandTag
	if err == nil {
		result, err = tx.Exec(r.Context(), `UPDATE applications x SET applicant_id=$1, program_id=(SELECT id FROM programs WHERE code=$2), average_score=$3, original_given=$4, benefit=$5, updated_at=now() WHERE x.id=$6`, applicantID, in.ProgramCode, in.AverageScore, in.OriginalGiven, in.Benefit, r.PathValue("id"))
	}
	if err != nil || result.RowsAffected() == 0 {
		respond(w, 409, map[string]string{"error": "cannot update application"})
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	s.invalidatePublicLists(r.Context())
	respond(w, 200, map[string]bool{"ok": true})
}

var digits = regexp.MustCompile(`\D`)
var fullNamePart = regexp.MustCompile(`^[\p{L}-]+$`)

func formatSNILS(v string) (string, error) {
	v = digits.ReplaceAllString(v, "")
	if len(v) != 11 {
		return "", errors.New("SNILS must contain 11 digits")
	}
	return fmt.Sprintf("%s-%s-%s %s", v[:3], v[3:6], v[6:9], v[9:]), nil
}
func applicationErrorMessage(err error) string {
	var dbError *pgconn.PgError
	if errors.As(err, &dbError) {
		switch dbError.ConstraintName {
		case "applications_applicant_id_program_id_key":
			return "У этого абитуриента уже есть заявление на выбранную специальность."
		case "applications_one_original_per_applicant":
			return "Оригинал уже указан у заявления на другую специальность."
		}
		if strings.Contains(dbError.Message, "at most three applications") {
			return "Нельзя добавить больше трёх заявлений одному абитуриенту."
		}
	}
	return "Не удалось добавить заявление. Проверьте введённые данные."
}
func validFullName(value string) bool {
	parts := strings.Fields(value)
	if len(parts) < 3 {
		return false
	}
	for _, part := range parts {
		if !fullNamePart.MatchString(part) {
			return false
		}
	}
	return true
}
func validAverageScore(value float64) bool {
	return value >= 0 && value <= 5 && math.Abs(value*1000-math.Round(value*1000)) < 0.000001
}

func (s *server) importApplications(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var in importApplicationsRequest
	if json.NewDecoder(io.LimitReader(r.Body, 5<<20)).Decode(&in) != nil || len(in.Applications) == 0 || len(in.Applications) > 2000 {
		respond(w, 400, map[string]string{"error": "invalid import data"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer tx.Rollback(r.Context())
	var programID int64
	if err = tx.QueryRow(r.Context(), `SELECT id FROM programs WHERE code=$1`, in.ProgramCode).Scan(&programID); err != nil {
		respond(w, 400, map[string]string{"error": "unknown program"})
		return
	}
	type rowError struct {
		Row      int    `json:"row"`
		FullName string `json:"fullName"`
		Error    string `json:"error"`
	}
	result := struct {
		Created int        `json:"created"`
		Updated int        `json:"updated"`
		Errors  []rowError `json:"errors"`
	}{Errors: []rowError{}}
	seenSNILS := map[string]bool{}
	for index, item := range in.Applications {
		rowNumber := item.Row
		if rowNumber < 1 {
			rowNumber = index + 1
		}
		snils, validationErr := formatSNILS(item.SNILS)
		if validationErr != nil || !validFullName(item.FullName) || !validAverageScore(item.AverageScore) {
			result.Errors = append(result.Errors, rowError{Row: rowNumber, FullName: strings.TrimSpace(item.FullName), Error: "Проверьте СНИЛС, ФИО и средний балл."})
			continue
		}
		if seenSNILS[snils] {
			result.Errors = append(result.Errors, rowError{Row: rowNumber, FullName: strings.TrimSpace(item.FullName), Error: "Повторяющийся СНИЛС в одном файле."})
			continue
		}
		seenSNILS[snils] = true

		rowTx, err := tx.Begin(r.Context())
		if err != nil {
			respond(w, 500, map[string]string{"error": "database error"})
			return
		}
		var applicantID int64
		err = rowTx.QueryRow(r.Context(), `INSERT INTO applicants(snils,full_name) VALUES($1,$2) ON CONFLICT(snils) DO UPDATE SET full_name=EXCLUDED.full_name,updated_at=now() RETURNING id`, snils, strings.TrimSpace(item.FullName)).Scan(&applicantID)
		var applicationID int64
		if err == nil {
			err = rowTx.QueryRow(r.Context(), `SELECT id FROM applications WHERE applicant_id=$1 AND program_id=$2 FOR UPDATE`, applicantID, programID).Scan(&applicationID)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = rowTx.Exec(r.Context(), `INSERT INTO applications(applicant_id,program_id,average_score,original_given,benefit) VALUES($1,$2,$3,$4,$5)`, applicantID, programID, item.AverageScore, item.OriginalGiven, item.Benefit)
			if err == nil {
				result.Created++
			}
		} else if err == nil {
			_, err = rowTx.Exec(r.Context(), `UPDATE applications SET average_score=$1,original_given=$2,benefit=$3,updated_at=now() WHERE id=$4`, item.AverageScore, item.OriginalGiven, item.Benefit, applicationID)
			if err == nil {
				result.Updated++
			}
		}
		if err != nil {
			_ = rowTx.Rollback(r.Context())
			result.Errors = append(result.Errors, rowError{Row: rowNumber, FullName: strings.TrimSpace(item.FullName), Error: applicationErrorMessage(err)})
			continue
		}
		if err = rowTx.Commit(r.Context()); err != nil {
			respond(w, 500, map[string]string{"error": "database error"})
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	if result.Created+result.Updated > 0 {
		s.invalidatePublicLists(r.Context())
	}
	respond(w, 200, result)
}

func (s *server) createApplication(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var in createApplicationRequest
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON"})
		return
	}
	snils, err := formatSNILS(in.SNILS)
	if err != nil || !validFullName(in.FullName) || !validAverageScore(in.AverageScore) {
		respond(w, 400, map[string]string{"error": "check SNILS, full name and average score"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer tx.Rollback(r.Context())
	var applicantID int64
	if err = tx.QueryRow(r.Context(), `INSERT INTO applicants(snils,full_name) VALUES($1,$2) ON CONFLICT(snils) DO UPDATE SET full_name=EXCLUDED.full_name,updated_at=now() RETURNING id`, snils, strings.TrimSpace(in.FullName)).Scan(&applicantID); err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO applications(applicant_id,program_id,average_score,original_given,benefit) VALUES($1,(SELECT id FROM programs WHERE code=$2),$3,$4,$5)`, applicantID, in.ProgramCode, in.AverageScore, in.OriginalGiven, in.Benefit)
	if err != nil {
		respond(w, 409, map[string]string{"error": applicationErrorMessage(err)})
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	s.invalidatePublicLists(r.Context())
	respond(w, 201, map[string]bool{"ok": true})
}
func (s *server) publish(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		respond(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		respond(w, 500, map[string]string{"error": "database error"})
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE publication_versions SET is_current=false WHERE is_current`)
	if err == nil {
		var id int64
		err = tx.QueryRow(r.Context(), `INSERT INTO publication_versions(is_current,published_at) VALUES(true,now()) RETURNING id`).Scan(&id)
		if err == nil {
			_, err = tx.Exec(r.Context(), `INSERT INTO published_applications(version_id,program_code,full_name,average_score,original_given,benefit) SELECT $1,p.code,a.full_name,x.average_score,x.original_given,x.benefit FROM applications x JOIN applicants a ON a.id=x.applicant_id JOIN programs p ON p.id=x.program_id`, id)
			if err == nil {
				_, err = tx.Exec(r.Context(), `DELETE FROM applications`)
			}
		}
	}
	if err != nil {
		respond(w, 500, map[string]string{"error": "publish failed"})
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		respond(w, 500, map[string]string{"error": "publish failed"})
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
