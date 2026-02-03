{{- define "dln-indexer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dln-indexer.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "dln-indexer.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "dln-indexer.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "dln-indexer.labels" -}}
helm.sh/chart: {{ include "dln-indexer.chart" . }}
{{ include "dln-indexer.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "dln-indexer.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dln-indexer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
