@{
    # PSScriptAnalyzer config for install.ps1 (used by CI).
    # We lint at Warning+Error but exclude rules that are intentional for a
    # user-facing bootstrap installer rather than a reusable module/cmdlet.
    Severity = @('Error', 'Warning')

    ExcludeRules = @(
        # The installer prints colored, human-facing progress. Write-Host is the
        # correct tool here — there is no pipeline consumer of this output.
        'PSAvoidUsingWriteHost',

        # Internal helpers (Set-SeedConfig, Update-SessionPath, Update-SkillStage)
        # are not a public cmdlet surface, so -WhatIf/-Confirm would be noise.
        'PSUseShouldProcessForStateChangingFunctions'
    )
}