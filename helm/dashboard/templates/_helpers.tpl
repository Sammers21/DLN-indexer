{{- define "dln-dashboard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dln-dashboard.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "dln-dashboard.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "dln-dashboard.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "dln-dashboard.labels" -}}
helm.sh/chart: {{ include "dln-dashboard.chart" . }}
{{ include "dln-dashboard.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "dln-dashboard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dln-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
